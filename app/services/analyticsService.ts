import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "~/db";
import { coupons, courses, purchases } from "~/db/schema";

// ─── Analytics Service ───
// Instructor-facing analytics: earnings, completion, drop-off.
// Uses positional parameters (project convention).
// Date bounds are ISO strings; null means unbounded.

export type CourseEarnings = {
  courseId: number;
  title: string;
  total: number;
  team: number;
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
      team: sql<number>`coalesce(sum(case when ${isTeamSale} then ${purchases.amountPaid} else 0 end), 0)`,
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
    team: row.team,
    direct: row.total - row.team,
  }));

  const total = byCourse.reduce((sum, c) => sum + c.total, 0);
  const team = byCourse.reduce((sum, c) => sum + c.team, 0);

  return { total, team, direct: total - team, byCourse };
}
