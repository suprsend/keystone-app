// Tasks and comments for a project, stored as ARRAY PROPERTIES on the project OBJECT
// in SuprSend (alongside `name` and `state`). Nothing lives in our backend — the
// object is the source of truth. Reads/writes go through objects.get / objects.upsert.
import "server-only";
import type { Workspace } from "@/lib/workspaces";
import { suprsendClient as client, hasWorkspaceKeys } from "@/lib/server/workspace";

const PROJECT_OBJECT = "project";

export interface Task {
  id: string;
  name: string;
  assigneeId: string;
  status: string; // "In progress" | "Completed"
  dueDate: string; // ISO date (YYYY-MM-DD)
}
export interface Comment {
  id: string;
  authorId: string;
  body: string;
  at: string; // ISO timestamp
  mentionId?: string; // set when the comment @mentions someone (→ Tagged, not Comment Added)
}

export const TASK_STATUSES = ["In progress", "Completed"];

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function getProps(ws: Workspace, projectId: string): Promise<{ tasks?: Task[]; comments?: Comment[] }> {
  if (!hasWorkspaceKeys(ws)) return {};
  try {
    const o = (await client(ws).objects.get(PROJECT_OBJECT, projectId)) as {
      properties?: { tasks?: Task[]; comments?: Comment[] };
    };
    return o?.properties ?? {};
  } catch {
    return {};
  }
}

export async function getTasks(ws: Workspace, projectId: string): Promise<Task[]> {
  return (await getProps(ws, projectId)).tasks ?? [];
}

export async function addTask(
  ws: Workspace,
  projectId: string,
  data: { name: string; assigneeId: string; dueDate: string },
): Promise<Task> {
  const tasks = await getTasks(ws, projectId);
  const task: Task = { id: rid("t"), name: data.name, assigneeId: data.assigneeId, status: "In progress", dueDate: data.dueDate };
  await client(ws).objects.upsert(PROJECT_OBJECT, projectId, { tasks: [...tasks, task] });
  return task;
}

export async function setTaskStatus(
  ws: Workspace,
  projectId: string,
  taskId: string,
  status: string,
): Promise<Task | null> {
  const tasks = await getTasks(ws, projectId);
  const next = tasks.map((t) => (t.id === taskId ? { ...t, status } : t));
  const updated = next.find((t) => t.id === taskId) ?? null;
  await client(ws).objects.upsert(PROJECT_OBJECT, projectId, { tasks: next });
  return updated;
}

export async function getComments(ws: Workspace, projectId: string): Promise<Comment[]> {
  return (await getProps(ws, projectId)).comments ?? [];
}

export async function addComment(
  ws: Workspace,
  projectId: string,
  data: { authorId: string; body: string; mentionId?: string },
  nowIso: string,
): Promise<Comment> {
  const comments = await getComments(ws, projectId);
  const comment: Comment = { id: rid("c"), authorId: data.authorId, body: data.body, at: nowIso };
  if (data.mentionId) comment.mentionId = data.mentionId;
  await client(ws).objects.upsert(PROJECT_OBJECT, projectId, { comments: [...comments, comment] });
  return comment;
}
