import { UserRole } from "~/db/schema";

/**
 * The page a user lands on after logging in when no `redirectTo` is given.
 * Instructors start in their analytics; everyone else starts in the catalogue.
 */
export function landingPathForRole(role: UserRole): string {
  return role === UserRole.Instructor ? "/instructor/analytics" : "/courses";
}
