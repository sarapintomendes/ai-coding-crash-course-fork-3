import { Form, Link } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { data, isRouteErrorResponse } from "react-router";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import {
  getCourseCompletionRate,
  getInstructorEarnings,
} from "~/services/analyticsService";
import { UserRole } from "~/db/schema";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { formatPrice } from "~/lib/utils";

export function meta() {
  return [
    { title: "Analytics — Cadence" },
    { name: "description", content: "Earnings for your courses" },
  ];
}

// "Last 30 days" includes today, so the window starts 29 days back.
const DEFAULT_RANGE_DAYS = 29;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

// The range is a pair of calendar dates from the query string. The loader turns
// them into inclusive day bounds so a purchase on the final day is counted.
// A missing or malformed date falls back to the default rather than silently
// returning zeros.
function resolveRange(url: URL) {
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - DEFAULT_RANGE_DAYS);

  const parse = (value: string | null, fallback: string) =>
    value && ISO_DATE.test(value) ? value : fallback;

  const from = parse(url.searchParams.get("from"), isoDate(defaultFrom));
  const to = parse(url.searchParams.get("to"), isoDate(today));

  return {
    from,
    to,
    fromBound: `${from}T00:00:00.000Z`,
    toBound: `${to}T23:59:59.999Z`,
  };
}

// Returns inclusive bounds for the completion rate only when the dates are
// explicitly given. Otherwise null, which means all time.
function explicitBounds(url: URL) {
  const pick = (name: string, suffix: string) => {
    const value = url.searchParams.get(name);
    return value && ISO_DATE.test(value) ? `${value}T${suffix}` : null;
  };

  return {
    from: pick("from", "00:00:00.000Z"),
    to: pick("to", "23:59:59.999Z"),
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your analytics.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (!user || user.role !== UserRole.Instructor) {
    throw data("Only instructors can access this page.", {
      status: 403,
    });
  }

  const url = new URL(request.url);
  const range = resolveRange(url);
  const earnings = getInstructorEarnings(
    currentUserId,
    range.fromBound,
    range.toBound
  );

  // Completion rate filters by enrollment date and defaults to all time, so it
  // only uses dates that are explicitly in the URL.
  const explicit = explicitBounds(url);
  const byCourse = earnings.byCourse.map((course) => ({
    ...course,
    completion: getCourseCompletionRate(
      course.courseId,
      explicit.from,
      explicit.to
    ),
  }));

  return {
    range: { from: range.from, to: range.to },
    earnings: { ...earnings, byCourse },
  };
}

// Shown as a percentage of enrolled students who completed the course.
// Courses with nobody enrolled show 0%.
function formatCompletion(completion: { rate: number; enrolled: number }) {
  if (completion.enrolled === 0) return "0%";
  return `${Math.round(completion.rate * 100)}%`;
}

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const { range, earnings } = loaderData;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Gross earnings from purchases in the selected period.
        </p>
      </div>

      <Form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">
          From
          <input
            type="date"
            name="from"
            defaultValue={range.from}
            className="rounded-md border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          To
          <input
            type="date"
            name="to"
            defaultValue={range.to}
            className="rounded-md border px-2 py-1"
          />
        </label>
        <Button type="submit">Apply</Button>
      </Form>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-medium text-muted-foreground">Total gross</h2>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPrice(earnings.total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="text-sm font-medium text-muted-foreground">Direct sales</h2>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPrice(earnings.direct)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="text-sm font-medium text-muted-foreground">Team / coupon sales</h2>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPrice(earnings.teamSales)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">By course</h2>
        </CardHeader>
        <CardContent>
          {earnings.byCourse.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have no courses yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Course</th>
                  <th className="py-2 text-right">Total</th>
                  <th className="py-2 text-right">Direct</th>
                  <th className="py-2 text-right">Team / coupon</th>
                  <th className="py-2 text-right">Completion</th>
                </tr>
              </thead>
              <tbody>
                {earnings.byCourse.map((course) => (
                  <tr key={course.courseId} className="border-b">
                    <td className="py-2">
                      <Link
                        to={`/instructor/analytics/${course.courseId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {course.title}
                      </Link>
                    </td>
                    <td className="py-2 text-right">{formatPrice(course.total)}</td>
                    <td className="py-2 text-right">{formatPrice(course.direct)}</td>
                    <td className="py-2 text-right">{formatPrice(course.teamSales)}</td>
                    <td className="py-2 text-right">
                      {formatCompletion(course.completion)}
                    </td>
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
  let message = "An unexpected error occurred while loading your analytics.";

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
          : "You don't have permission to access this page.";
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
