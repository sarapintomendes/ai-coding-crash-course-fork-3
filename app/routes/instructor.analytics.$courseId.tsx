import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.analytics.$courseId";
import { z } from "zod";
import { getCurrentUserId } from "~/lib/session";
import { parseParams } from "~/lib/validation";
import { getUserById } from "~/services/userService";
import { getCourseDrillDown } from "~/services/analyticsService";
import { UserRole } from "~/db/schema";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { AlertTriangle, ArrowLeft } from "lucide-react";

export function meta() {
  return [
    { title: "Course Analytics — Cadence" },
    { name: "description", content: "Enrollments and ratings for one course" },
  ];
}

const analyticsParamsSchema = z.object({
  courseId: z.coerce.number().int(),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your analytics.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (!user || user.role !== UserRole.Instructor) {
    throw data("Only instructors can access this page.", { status: 403 });
  }

  const { courseId } = parseParams(params, analyticsParamsSchema);
  const course = getCourseDrillDown(currentUserId, courseId);

  // Another instructor's course (or one that doesn't exist) is refused the same way.
  if (!course) {
    throw data("You can only view analytics for your own courses.", {
      status: 403,
    });
  }

  return { course };
}

export default function InstructorCourseAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const { course } = loaderData;
  const { average, count } = course.rating;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link
          to="/instructor/analytics"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to analytics
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{course.title}</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-medium text-muted-foreground">Enrollments</h2>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{course.enrollmentCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="text-sm font-medium text-muted-foreground">Average rating</h2>
          </CardHeader>
          <CardContent>
            {average === null ? (
              <p className="text-sm text-muted-foreground">No ratings yet.</p>
            ) : (
              <p className="text-2xl font-bold">
                {average.toFixed(1)}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  from {count} {count === 1 ? "rating" : "ratings"}
                </span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">New enrollments per week</h2>
        </CardHeader>
        <CardContent>
          {course.weeklyEnrollments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No enrollments yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Week starting</th>
                  <th className="py-2 text-right">Enrollments</th>
                </tr>
              </thead>
              <tbody>
                {course.weeklyEnrollments.map((week) => (
                  <tr key={week.weekStart} className="border-b">
                    <td className="py-2">{week.weekStart}</td>
                    <td className="py-2 text-right">{week.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading this course's analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to view this course.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-xl font-semibold">{title}</h1>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
