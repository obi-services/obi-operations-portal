import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type PortalProjectStatus = "active" | "inactive" | "cancelled";

export type ProjectManagementActor = {
  id: string;
  email: string;
  role: "admin" | "supervisor";
};

export type CreatePortalProjectInput = {
  clientId: string;
  externalProjectId: string;
  projectName: string;
  taskIdPrefix: string;
  status: string;
  includeInDashboard: boolean;
  notes: string;
  actor: ProjectManagementActor;
};

export type UpdatePortalProjectInput = {
  projectId: string;
  projectName: string;
  taskIdPrefix: string;
  status: string;
  includeInDashboard: boolean;
  notes: string;
  actor: ProjectManagementActor;
};

export type PortalProjectMutationResult = {
  projectId: string;
  externalProjectId: string;
  projectName: string;
  status: PortalProjectStatus;
};

export class PortalProjectError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "project_exists"
      | "task_prefix_exists"
      | "project_not_found"
      | "client_not_found"
      | "client_inactive"
      | "database_error",
  ) {
    super(message);
    this.name = "PortalProjectError";
  }
}

function normalizeExternalProjectId(value: string): string {
  return value.trim();
}

function normalizeProjectName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeTaskIdPrefix(value: string): string | null {
  const prefix = value.trim().toUpperCase();

  return prefix ? prefix : null;
}

function normalizeNotes(value: string): string | null {
  const notes = value.trim();

  return notes ? notes : null;
}

function validateUuid(value: string, label: string): string {
  const id = value.trim();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    throw new PortalProjectError(
      `${label} identifier is invalid.`,
      "invalid_input",
    );
  }

  return id;
}

function validateExternalProjectId(value: string): string {
  const externalProjectId = normalizeExternalProjectId(value);

  if (externalProjectId.length < 1 || externalProjectId.length > 160) {
    throw new PortalProjectError(
      "External Project ID must contain between 1 and 160 characters.",
      "invalid_input",
    );
  }

  if (!/^[A-Za-z0-9._-]+$/.test(externalProjectId)) {
    throw new PortalProjectError(
      "External Project ID may contain letters, numbers, periods, hyphens, and underscores only.",
      "invalid_input",
    );
  }

  return externalProjectId;
}

function validateProjectName(value: string): string {
  const projectName = normalizeProjectName(value);

  if (projectName.length < 2 || projectName.length > 160) {
    throw new PortalProjectError(
      "Project name must contain between 2 and 160 characters.",
      "invalid_input",
    );
  }

  return projectName;
}

function validateTaskIdPrefix(value: string): string | null {
  const taskIdPrefix = normalizeTaskIdPrefix(value);

  if (!taskIdPrefix) {
    return null;
  }

  if (taskIdPrefix.length > 40) {
    throw new PortalProjectError(
      "Task ID Prefix cannot exceed 40 characters.",
      "invalid_input",
    );
  }

  if (!/^[A-Z0-9_-]+$/.test(taskIdPrefix)) {
    throw new PortalProjectError(
      "Task ID Prefix may contain letters, numbers, hyphens, and underscores only.",
      "invalid_input",
    );
  }

  return taskIdPrefix;
}

function validateStatus(value: string): PortalProjectStatus {
  if (
    value !== "active" &&
    value !== "inactive" &&
    value !== "cancelled"
  ) {
    throw new PortalProjectError(
      "Select a valid project status.",
      "invalid_input",
    );
  }

  return value;
}

function validateNotes(value: string): string | null {
  const notes = normalizeNotes(value);

  if (notes && notes.length > 2000) {
    throw new PortalProjectError(
      "Project notes cannot exceed 2,000 characters.",
      "invalid_input",
    );
  }

  return notes;
}

async function assertClientSupportsStatus(
  supabase: SupabaseClient,
  clientId: string,
  projectStatus: PortalProjectStatus,
): Promise<void> {
  const { data: client, error } = await supabase
    .from("clients")
    .select("id, client_code, status")
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    throw new PortalProjectError(
      `Unable to verify the client record: ${error.message}`,
      "database_error",
    );
  }

  if (!client) {
    throw new PortalProjectError(
      "The selected client could not be found.",
      "client_not_found",
    );
  }

  if (projectStatus === "active" && client.status !== "active") {
    throw new PortalProjectError(
      `Active projects require an active client. ${client.client_code} is currently ${client.status}.`,
      "client_inactive",
    );
  }
}

function throwProjectWriteError(
  error: {
    code?: string;
    message?: string;
    details?: string | null;
  },
  externalProjectId: string,
  taskIdPrefix: string | null,
): never {
  if (error.code === "23505") {
    const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

    if (text.includes("task_id_prefix")) {
      throw new PortalProjectError(
        `Task ID Prefix ${taskIdPrefix ?? ""} already exists.`,
        "task_prefix_exists",
      );
    }

    throw new PortalProjectError(
      `External Project ID ${externalProjectId} already exists.`,
      "project_exists",
    );
  }

  throw new PortalProjectError(
    `Unable to save the project: ${error.message ?? "Unknown database error."}`,
    "database_error",
  );
}

export async function createPortalProject(
  supabase: SupabaseClient,
  input: CreatePortalProjectInput,
): Promise<PortalProjectMutationResult> {
  const clientId = validateUuid(input.clientId, "Client");
  const externalProjectId = validateExternalProjectId(
    input.externalProjectId,
  );
  const projectName = validateProjectName(input.projectName);
  const taskIdPrefix = validateTaskIdPrefix(input.taskIdPrefix);
  const status = validateStatus(input.status);
  const notes = validateNotes(input.notes);

  await assertClientSupportsStatus(supabase, clientId, status);

  const { data, error } = await supabase
    .from("projects")
    .insert({
      client_id: clientId,
      external_project_id: externalProjectId,
      project_name: projectName,
      task_id_prefix: taskIdPrefix,
      status,
      include_in_dashboard: input.includeInDashboard,
      notes,
    })
    .select("id, external_project_id, project_name, status")
    .single();

  if (error) {
    throwProjectWriteError(error, externalProjectId, taskIdPrefix);
  }

  return {
    projectId: data.id as string,
    externalProjectId: data.external_project_id as string,
    projectName: data.project_name as string,
    status: data.status as PortalProjectStatus,
  };
}

export async function updatePortalProject(
  supabase: SupabaseClient,
  input: UpdatePortalProjectInput,
): Promise<PortalProjectMutationResult> {
  const projectId = validateUuid(input.projectId, "Project");
  const projectName = validateProjectName(input.projectName);
  const taskIdPrefix = validateTaskIdPrefix(input.taskIdPrefix);
  const status = validateStatus(input.status);
  const notes = validateNotes(input.notes);

  const { data: existingProject, error: existingProjectError } =
    await supabase
      .from("projects")
      .select("id, client_id, external_project_id")
      .eq("id", projectId)
      .maybeSingle();

  if (existingProjectError) {
    throw new PortalProjectError(
      `Unable to load the project record: ${existingProjectError.message}`,
      "database_error",
    );
  }

  if (!existingProject) {
    throw new PortalProjectError(
      "The project record could not be found.",
      "project_not_found",
    );
  }

  await assertClientSupportsStatus(
    supabase,
    existingProject.client_id as string,
    status,
  );

  const { data, error } = await supabase
    .from("projects")
    .update({
      project_name: projectName,
      task_id_prefix: taskIdPrefix,
      status,
      include_in_dashboard: input.includeInDashboard,
      notes,
    })
    .eq("id", projectId)
    .select("id, external_project_id, project_name, status")
    .single();

  if (error) {
    throwProjectWriteError(
      error,
      existingProject.external_project_id as string,
      taskIdPrefix,
    );
  }

  return {
    projectId: data.id as string,
    externalProjectId: data.external_project_id as string,
    projectName: data.project_name as string,
    status: data.status as PortalProjectStatus,
  };
}
