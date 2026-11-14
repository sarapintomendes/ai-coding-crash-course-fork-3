import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "~/db";
import { coupons, courses, enrollments, purchases } from "~/db/schema";
import { getEnrollmentCountForCourse } from "~/services/enrollmentService";
import {
  getCourseRatingSummary,
  type CourseRatingSummary,
} from "~/services/courseRatingService";

// ─── Analytics Service ───
// Instructor-facing analytics: earnings, completion, drop-off.
// Uses positional parameters (project convention).
// Date bounds are ISO strings; null means unbounded.

export type CourseEarnings = {
  courseId: number;
  title: string;
  total: number;
  teamSales: number;
  direct: number;
};

export function getInstructorEarnings(
  instructorId: number,
  from: string | null,
  to: string | null
) {
  // Date bounds sit in the join condition, not the WHERE, so that courses with
  // no purchases in range still appear with zeros.
  const purchaseConditions: SQL[] = [eq(purchases.courseId, courses.id)];
  if (from) purchaseConditions.push(gte(purchases.createdAt, from));
  if (to) purchaseConditions.push(lte(purchases.createdAt, to));

  // A purchase is a team sale when coupons were generated from it. Checked with
  // EXISTS rather than a join, since one team purchase can produce many coupons.
  const isTeamSale = sql`exists (select 1 from ${coupons} where ${coupons.purchaseId} = ${purchases.id})`;

  const rows = db
    .select({
      courseId: courses.id,
      title: courses.title,
      total: sql<number>`coalesce(sum(${purchases.amountPaid}), 0)`,
      teamSales: sql<number>`coalesce(sum(case when ${isTeamSale} then ${purchases.amountPaid} else 0 end), 0)`,
    })
    .from(courses)
    .leftJoin(purchases, and(...purchaseConditions))
    .where(eq(courses.instructorId, instructorId))
    .groupBy(courses.id, courses.title)
    .orderBy(asc(courses.id))
    .all();

  const byCourse: CourseEarnings[] = rows.map((row) => ({
    courseId: row.courseId,
    title: row.title,
    total: row.total,
    teamSales: row.teamSales,
    direct: row.total - row.teamSales,
  }));

  const total = byCourse.reduce((sum, c) => sum + c.total, 0);
  const teamSales = byCourse.reduce((sum, c) => sum + c.teamSales, 0);

  return { total, teamSales, direct: total - teamSales, byCourse };
}

// ─── Completion rate ───

export type CourseCompletionRate = {
  completed: number;
  enrolled: number;
  /** Completed divided by enrolled, as a fraction from 0 to 1. Zero when nobody is enrolled. */
  rate: number;
};

/**
 * Share of a course's currently enrolled students who have completed it.
 * Unenrolling deletes the enrollment row, so those students drop out of both
 * sides. `from`/`to` bound the enrollment date; null means all time.
 */
export function getCourseCompletionRate(
  courseId: number,
  from: string | null,
  to: string | null
): CourseCompletionRate {
  const conditions: SQL[] = [eq(enrollments.courseId, courseId)];
  if (from) conditions.push(gte(enrollments.enrolledAt, from));
  if (to) conditions.push(lte(enrollments.enrolledAt, to));

  const row = db
    .select({
      enrolled: sql<number>`count(*)`,
      completed: sql<number>`count(${enrollments.completedAt})`,
    })
    .from(enrollments)
    .where(and(...conditions))
    .get();

  const enrolled = row?.enrolled ?? 0;
  const completed = row?.completed ?? 0;

  return {
    completed,
    enrolled,
    rate: enrolled === 0 ? 0 : completed / enrolled,
  };
}

// ─── Course drill-down ───

export type WeeklyEnrollment = {
  /** The Monday that starts the week, as YYYY-MM-DD. */
  weekStart: string;
  count: number;
};

export type CourseDrillDown = {
  courseId: number;
  title: string;
  enrollmentCount: number;
  rating: CourseRatingSummary;
  completionRate: CourseCompletionRate;
  weeklyEnrollments: WeeklyEnrollment[];
};

/**
 * One course's own view for its instructor. Returns null when the course doesn't
 * exist or belongs to someone else, so callers can refuse both the same way.
 */
export function getCourseDrillDown(
  instructorId: number,
  courseId: number
): CourseDrillDown | null {
  const course = db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.instructorId, instructorId)))
    .get();

  if (!course) return null;

  // 'weekday 0' moves to the next Sunday (or stays on it), and '-6 days' then
  // lands on the Monday of that Monday-to-Sunday week.
  const weekStart = sql<string>`date(${enrollments.enrolledAt}, 'weekday 0', '-6 days')`;

  const weekly = db
    .select({
      weekStart,
      count: sql<number>`count(*)`,
    })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .groupBy(weekStart)
    .orderBy(asc(weekStart))
    .all();

  return {
    courseId: course.id,
    title: course.title,
    enrollmentCount: getEnrollmentCountForCourse(courseId),
    rating: getCourseRatingSummary(courseId),
    completionRate: getCourseCompletionRate(courseId, null, null),
    weeklyEnrollments: weekly,
  };
}
