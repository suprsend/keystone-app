// Keystone's project-role RULES — app behaviour, not data. A project has exactly one
// Project Manager (required), at most one Process Owner and one Project Sponsor, and
// any number of Team Members.
//
// The roles a notification can TARGET are not listed here: they are read live from
// SuprSend (the `role` choices on each preference category — getRoleOptions()).

export const PROJECT_MANAGER = "Project Manager";
export const PROCESS_OWNER = "Process Owner";
export const PROJECT_SPONSOR = "Project Sponsor";
export const TEAM_MEMBER = "Team Member";

/** Roles only one person can hold on a project, in display order. */
export const SINGLE_ROLES = [PROJECT_MANAGER, PROCESS_OWNER, PROJECT_SPONSOR];

/** Roles with their own section in Resources. Any other subscriber (e.g. a Watcher) is listed under Others. */
export const FORMAL_ROLES = [...SINGLE_ROLES, TEAM_MEMBER];
