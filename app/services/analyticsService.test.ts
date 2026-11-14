import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  getInstructorEarnings,
  getCourseDrillDown,
  getCourseCompletionRate,
} from "./analyticsService";
import { unenrollUser } from "./enrollmentService";

function addPurchase(
  userId: number,
  courseId: number,
  amountPaid: number,
  createdAt = "2026-11-01T10:00:00.000Z"
) {
  return testDb
    .insert(schema.purchases)
    .values({ userId, courseId, amountPaid, country: null, createdAt })
    .returning()
    .get();
}

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getInstructorEarnings", () => {
    it("sums gross amount paid across the instructor's course purchases", () => {
      addPurchase(base.user.id, base.course.id, 4000);
      addPurchase(base.user.id, base.course.id, 2500);

      const earnings = getInstructorEarnings(base.instructor.id, null, null);

      expect(earnings.total).toBe(6500);
    });

    it("counts only purchases made within the date range", () => {
      addPurchase(base.user.id, base.course.id, 4000, "2026-11-01T10:00:00.000Z");
      addPurchase(base.user.id, base.course.id, 9999, "2026-09-01T10:00:00.000Z");

      const earnings = getInstructorEarnings(
        base.instructor.id,
        "2026-10-15T00:00:00.000Z",
        "2026-11-14T23:59:59.999Z"
      );

      expect(earnings.total).toBe(4000);
    });

    it("separates team/coupon purchases from direct sales", () => {
      addPurchase(base.user.id, base.course.id, 4000);
      const teamPurchase = addPurchase(base.user.id, base.course.id, 7500);

      const teamSales = testDb
        .insert(schema.teams)
        .values({})
        .returning()
        .get();
      testDb
        .insert(schema.coupons)
        .values({
          teamId: teamSales.id,
          courseId: base.course.id,
          code: "TEAM-SPLIT-1",
          purchaseId: teamPurchase.id,
        })
        .run();

      const earnings = getInstructorEarnings(base.instructor.id, null, null);

      expect(earnings.direct).toBe(4000);
      expect(earnings.teamSales).toBe(7500);
      expect(earnings.total).toBe(11500);
    });

    it("excludes purchases on other instructors' courses", () => {
      const otherInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const otherCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Other Course",
          slug: "other-course",
          description: "Someone else's course",
          salesCopy: "## Other",
          instructorId: otherInstructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      addPurchase(base.user.id, base.course.id, 4000);
      addPurchase(base.user.id, otherCourse.id, 9999);

      const earnings = getInstructorEarnings(base.instructor.id, null, null);

      expect(earnings.total).toBe(4000);
    });

    it("breaks earnings down per course, including courses with no sales", () => {
      const quietCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Quiet Course",
          slug: "quiet-course",
          description: "No sales yet",
          salesCopy: "## Quiet",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      addPurchase(base.user.id, base.course.id, 4000);

      const earnings = getInstructorEarnings(base.instructor.id, null, null);

      expect(earnings.byCourse).toEqual([
        {
          courseId: base.course.id,
          title: "Test Course",
          total: 4000,
          teamSales: 0,
          direct: 4000,
        },
        {
          courseId: quietCourse.id,
          title: "Quiet Course",
          total: 0,
          teamSales: 0,
          direct: 0,
        },
      ]);
    });

    it("returns zeros when the instructor has no purchases", () => {
      const earnings = getInstructorEarnings(base.instructor.id, null, null);

      expect(earnings.total).toBe(0);
      expect(earnings.teamSales).toBe(0);
      expect(earnings.direct).toBe(0);
    });
  });

  describe("getCourseCompletionRate", () => {
    function addStudent(email: string) {
      return testDb
        .insert(schema.users)
        .values({ name: email, email, role: schema.UserRole.Student })
        .returning()
        .get();
    }

    function enroll(
      userId: number,
      courseId: number,
      enrolledAt = "2026-11-02T09:00:00.000Z",
      completedAt: string | null = null
    ) {
      testDb
        .insert(schema.enrollments)
        .values({ userId, courseId, enrolledAt, completedAt })
        .run();
    }

    it("is completed enrollments divided by currently enrolled students", () => {
      const students = ["r1", "r2", "r3", "r4"].map((n) =>
        addStudent(`${n}@example.com`)
      );
      enroll(students[0].id, base.course.id, "2026-11-02T09:00:00.000Z", "2026-11-20T09:00:00.000Z");
      enroll(students[1].id, base.course.id);
      enroll(students[2].id, base.course.id);
      enroll(students[3].id, base.course.id);
      // Another course's completions must not count.
      const otherCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Other Course",
          slug: "other-course-rate",
          description: "Someone else's course",
          salesCopy: "## Other",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();
      enroll(students[0].id, otherCourse.id, "2026-11-02T09:00:00.000Z", "2026-11-20T09:00:00.000Z");

      expect(getCourseCompletionRate(base.course.id, null, null)).toEqual({
        completed: 1,
        enrolled: 4,
        rate: 0.25,
      });
    });

    it("excludes unenrolled students from numerator and denominator", () => {
      const a = addStudent("u-a@example.com");
      const b = addStudent("u-b@example.com");
      const c = addStudent("u-c@example.com");
      enroll(a.id, base.course.id, "2026-11-02T09:00:00.000Z", "2026-11-10T09:00:00.000Z");
      enroll(b.id, base.course.id);
      enroll(c.id, base.course.id, "2026-11-02T09:00:00.000Z", "2026-11-11T09:00:00.000Z");

      // c completed, then left the course.
      unenrollUser(c.id, base.course.id);

      expect(getCourseCompletionRate(base.course.id, null, null)).toEqual({
        completed: 1,
        enrolled: 2,
        rate: 0.5,
      });
    });

    it("returns zero, not an error, for a course with no enrollments", () => {
      expect(getCourseCompletionRate(base.course.id, null, null)).toEqual({
        completed: 0,
        enrolled: 0,
        rate: 0,
      });
    });

    it("counts only enrollments made within the date range", () => {
      const a = addStudent("d-a@example.com");
      const b = addStudent("d-b@example.com");
      const c = addStudent("d-c@example.com");
      // In range and completed.
      enroll(a.id, base.course.id, "2026-11-02T09:00:00.000Z", "2026-11-20T09:00:00.000Z");
      // In range, not completed.
      enroll(b.id, base.course.id, "2026-11-05T09:00:00.000Z");
      // Enrolled before the range, completed — must not count.
      enroll(c.id, base.course.id, "2026-09-01T09:00:00.000Z", "2026-09-10T09:00:00.000Z");

      expect(
        getCourseCompletionRate(
          base.course.id,
          "2026-10-15T00:00:00.000Z",
          "2026-11-14T23:59:59.999Z"
        )
      ).toEqual({ completed: 1, enrolled: 2, rate: 0.5 });
    });
  });

  describe("getCourseDrillDown", () => {
    function addStudent(email: string) {
      return testDb
        .insert(schema.users)
        .values({ name: email, email, role: schema.UserRole.Student })
        .returning()
        .get();
    }

    function addEnrollment(userId: number, courseId: number, enrolledAt: string) {
      testDb
        .insert(schema.enrollments)
        .values({ userId, courseId, enrolledAt })
        .run();
    }

    it("returns null for a course owned by another instructor", () => {
      const otherInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other-instructor@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();

      const drillDown = getCourseDrillDown(
        otherInstructor.id,
        base.course.id
      );

      expect(drillDown).toBeNull();
    });

    it("counts new enrollments per week, Monday to Sunday, for this course only", () => {
      const a = addStudent("a@example.com");
      const b = addStudent("b@example.com");
      const c = addStudent("c@example.com");

      // 2026-11-02 is a Monday; 2026-11-08 is the Sunday of the same week.
      addEnrollment(a.id, base.course.id, "2026-11-02T09:00:00.000Z");
      addEnrollment(b.id, base.course.id, "2026-11-08T23:00:00.000Z");
      // The following Monday starts a new week.
      addEnrollment(c.id, base.course.id, "2026-11-09T08:00:00.000Z");
      // Another course's enrollments must not leak in.
      const otherCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Other Course",
          slug: "other-course-drill",
          description: "Someone else's course",
          salesCopy: "## Other",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();
      addEnrollment(a.id, otherCourse.id, "2026-11-03T09:00:00.000Z");

      const drillDown = getCourseDrillDown(base.instructor.id, base.course.id);

      expect(drillDown?.enrollmentCount).toBe(3);
      expect(drillDown?.weeklyEnrollments).toEqual([
        { weekStart: "2026-11-02", count: 2 },
        { weekStart: "2026-11-09", count: 1 },
      ]);
    });

    it("reports the average rating and the number of ratings", () => {
      const a = addStudent("rate-a@example.com");
      const b = addStudent("rate-b@example.com");
      testDb
        .insert(schema.courseRatings)
        .values([
          { userId: a.id, courseId: base.course.id, rating: 4 },
          { userId: b.id, courseId: base.course.id, rating: 5 },
        ])
        .run();

      const drillDown = getCourseDrillDown(base.instructor.id, base.course.id);

      expect(drillDown?.rating).toEqual({ average: 4.5, count: 2 });
    });

    it("returns an empty state when the course has no ratings or enrollments", () => {
      const drillDown = getCourseDrillDown(base.instructor.id, base.course.id);

      expect(drillDown).toEqual({
        courseId: base.course.id,
        title: "Test Course",
        enrollmentCount: 0,
        rating: { average: null, count: 0 },
        completionRate: { completed: 0, enrolled: 0, rate: 0 },
        weeklyEnrollments: [],
      });
    });

    it("reports the completion rate for the course", () => {
      const a = addStudent("cr-a@example.com");
      const b = addStudent("cr-b@example.com");
      addEnrollment(a.id, base.course.id, "2026-11-02T09:00:00.000Z");
      testDb
        .insert(schema.enrollments)
        .values({
          userId: b.id,
          courseId: base.course.id,
          enrolledAt: "2026-11-03T09:00:00.000Z",
          completedAt: "2026-11-20T09:00:00.000Z",
        })
        .run();

      const drillDown = getCourseDrillDown(base.instructor.id, base.course.id);

      expect(drillDown?.completionRate).toEqual({
        completed: 1,
        enrolled: 2,
        rate: 0.5,
      });
    });
  });
});
