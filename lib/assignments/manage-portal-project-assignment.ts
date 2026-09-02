import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AssignmentManagementActor = {
  id: string;
  email: string;
  role: "admin" | "supervisor";
  status: "active";
};

export type PortalAssignmentStatus = "active" | "inactive";

export type AssignPortalAgentInput = {
  projectId: string;
  agentUserId: string;
  notes: string;
  actor: AssignmentManagementActor;
};

export type UnassignPortalAgentInput = {
  assignmentId: string;
  actor: AssignmentManagementActor;
};

export type PortalAssignmentMutationResult = {
  assignmentId: string;
  projectId: string;
  externalProjectId: string;
  projectName: string;
  agentUserId: string;
  agentEmail: string;
  agentFullName: string;
  status: PortalAssignmentStatus;
};

type ProjectRecord = {
  id: string;
  client_id: string;
  external_project_id: string;
  project_name: string;
  status: "active" | "inactive" | "cancelled";
};

type ClientRecord = {
  id: string;
  client_code: string;
  status: "active" | "inactive" | "cancelled";
};

type AgentProfile = {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "supervisor" | "agent";
  status: "invited" | "active" | "inactive" | "suspended";
};

type AssignmentRecord = {
  id: string;
  project_id: string;
  agent_user_id: string;
  status: PortalAssignmentStatus;
};

export class PortalProjectAssignmentError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "not_authorized"
      | "project_not_found"
      | "project_inactive"
      | "client_inactive"
      | "agent_not_found"
      | "agent_not_eligible"
      | "assignment_exists"
      | "assignment_not_found"
      | "assignment_inactive"
      | "database_error",
  ) {
    super(message);
    this.name = "PortalProjectAssignmentError";
  }
}

function validateUuid(value: string, label: string): string {
  const id = value.trim();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    throw new PortalProjectAssignmentError(
      `${label} identifier is invalid.`,
      "invalid_input",
    );
  }

  return id;
}

function validateNotes(value: string): string | null {
  const notes = value.trim();

  if (!notes) {
    return null;
  }

  if (notes.length > 2000) {
    throw new PortalProjectAssignmentError(
      "Assignment notes cannot exceed 2,000 characters.",
      "invalid_input",
    );
  }

  return notes;
}

async function assertActivePrivilegedActor(
  supabase: SupabaseClient,
  actor: AssignmentManagementActor,
): Promise<void> {
  const actorId = validateUuid(actor.id, "Actor");

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, status")
    .eq("id", actorId)
    .maybeSingle();

  if (error) {
    throw new PortalProjectAssignmentError(
      `Unable to verify the acting portal user: ${error.message}`,
      "database_error",
    );
  }

  if (
    !data ||
    data.status !== "active" ||
    !["admin", "supervisor"].includes(data.role)
  ) {
    throw new PortalProjectAssignmentError(
      "Only active administrators and supervisors can manage project assignments.",
      "not_authorized",
    );
  }
}

async function getActiveProject(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectRecord> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, client_id, external_project_id, project_name, status")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    throw new PortalProjectAssignmentError(
      `Unable to verify the project: ${projectError.message}`,
      "database_error",
    );
  }

  if (!project) {
    throw new PortalProjectAssignmentError(
      "The selected project could not be found.",
      "project_not_found",
    );
  }

  const typedProject = project as ProjectRecord;

  if (typedProject.status !== "active") {
    throw new PortalProjectAssignmentError(
      `${typedProject.external_project_id} is currently ${typedProject.status}. Only active projects can receive Agent assignments.`,
      "project_inactive",
    );
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, client_code, status")
    .eq("id", typedProject.client_id)
    .maybeSingle();

  if (clientError) {
    throw new PortalProjectAssignmentError(
      `Unable to verify the project's client: ${clientError.message}`,
      "database_error",
    );
  }

  if (!client) {
    throw new PortalProjectAssignmentError(
      "The Client attached to this project could not be found.",
      "database_error",
    );
  }

  const typedClient = client as ClientRecord;

  if (typedClient.status !== "active") {
    throw new PortalProjectAssignmentError(
      `Project ${typedProject.external_project_id} belongs to Client ${typedClient.client_code}, which is currently ${typedClient.status}.`,
      "client_inactive",
    );
  }

  return typedProject;
}

async function getEligibleAgent(
  supabase: SupabaseClient,
  agentUserId: string,
): Promise<AgentProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, status")
    .eq("id", agentUserId)
    .maybeSingle();

  if (error) {
    throw new PortalProjectAssignmentError(
      `Unable to verify the selected Agent: ${error.message}`,
      "database_error",
    );
  }

  if (!data) {
    throw new PortalProjectAssignmentError(
      "The selected Agent could not be found.",
      "agent_not_found",
    );
  }

  const agent = data as AgentProfile;

  if (agent.role !== "agent") {
    throw new PortalProjectAssignmentError(
      `${agent.full_name || agent.email} is not currently an Agent.`,
      "agent_not_eligible",
    );
  }

  if (agent.status !== "active") {
    throw new PortalProjectAssignmentError(
      `${agent.full_name || agent.email} is currently ${agent.status}. Only active Agents can receive project assignments.`,
      "agent_not_eligible",
    );
  }

  return agent;
}

async function getAssignment(
  supabase: SupabaseClient,
  assignmentId: string,
): Promise<AssignmentRecord> {
  const { data, error } = await supabase
    .from("project_assignments")
    .select("id, project_id, agent_user_id, status")
    .eq("id", assignmentId)
    .maybeSingle();

  if (error) {
    throw new PortalProjectAssignmentError(
      `Unable to load the project assignment: ${error.message}`,
      "database_error",
    );
  }

  if (!data) {
    throw new PortalProjectAssignmentError(
      "The selected project assignment could not be found.",
      "assignment_not_found",
    );
  }

  return data as AssignmentRecord;
}

function throwAssignmentWriteError(
  error: {
    code?: string;
    message?: string;
    details?: string | null;
  },
): never {
  const text =
    `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

  if (error.code === "23505") {
    throw new PortalProjectAssignmentError(
      "This Agent is already actively assigned to the selected project.",
      "assignment_exists",
    );
  }

  if (
    text.includes("only agent profiles") ||
    text.includes("only active agent profiles")
  ) {
    throw new PortalProjectAssignmentError(
      "Only active Agent profiles can receive project assignments.",
      "agent_not_eligible",
    );
  }

  if (text.includes("only active projects")) {
    throw new PortalProjectAssignmentError(
      "Only active projects can receive Agent assignments.",
      "project_inactive",
    );
  }

  if (text.includes("active clients")) {
    throw new PortalProjectAssignmentError(
      "Only projects belonging to active Clients can receive Agent assignments.",
      "client_inactive",
    );
  }

  throw new PortalProjectAssignmentError(
    `Unable to save the project assignment: ${
      error.message ?? "Unknown database error."
    }`,
    "database_error",
  );
}

export async function assignPortalAgentToProject(
  supabase: SupabaseClient,
  input: AssignPortalAgentInput,
): Promise<PortalAssignmentMutationResult> {
  const projectId = validateUuid(input.projectId, "Project");
  const agentUserId = validateUuid(input.agentUserId, "Agent");
  const notes = validateNotes(input.notes);

  await assertActivePrivilegedActor(supabase, input.actor);

  const project = await getActiveProject(supabase, projectId);
  const agent = await getEligibleAgent(supabase, agentUserId);

  const { data: existingAssignment, error: existingAssignmentError } =
    await supabase
      .from("project_assignments")
      .select("id")
      .eq("project_id", project.id)
      .eq("agent_user_id", agent.id)
      .eq("status", "active")
      .maybeSingle();

  if (existingAssignmentError) {
    throw new PortalProjectAssignmentError(
      `Unable to check the current Agent assignment: ${existingAssignmentError.message}`,
      "database_error",
    );
  }

  if (existingAssignment) {
    throw new PortalProjectAssignmentError(
      `${agent.full_name || agent.email} is already assigned to ${project.external_project_id}.`,
      "assignment_exists",
    );
  }

  const { data, error } = await supabase
    .from("project_assignments")
    .insert({
      project_id: project.id,
      agent_user_id: agent.id,
      status: "active",
      assigned_by: input.actor.id,
      notes,
    })
    .select("id, project_id, agent_user_id, status")
    .single();

  if (error) {
    throwAssignmentWriteError(error);
  }

  return {
    assignmentId: data.id as string,
    projectId: project.id,
    externalProjectId: project.external_project_id,
    projectName: project.project_name,
    agentUserId: agent.id,
    agentEmail: agent.email,
    agentFullName: agent.full_name,
    status: data.status as PortalAssignmentStatus,
  };
}

export async function unassignPortalAgentFromProject(
  supabase: SupabaseClient,
  input: UnassignPortalAgentInput,
): Promise<PortalAssignmentMutationResult> {
  const assignmentId = validateUuid(input.assignmentId, "Assignment");

  await assertActivePrivilegedActor(supabase, input.actor);

  const assignment = await getAssignment(supabase, assignmentId);

  if (assignment.status !== "active") {
    throw new PortalProjectAssignmentError(
      "This project assignment is already inactive.",
      "assignment_inactive",
    );
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, external_project_id, project_name")
    .eq("id", assignment.project_id)
    .maybeSingle();

  if (projectError || !project) {
    throw new PortalProjectAssignmentError(
      projectError
        ? `Unable to load the assigned project: ${projectError.message}`
        : "The assigned project could not be found.",
      "database_error",
    );
  }

  const { data: agent, error: agentError } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", assignment.agent_user_id)
    .maybeSingle();

  if (agentError || !agent) {
    throw new PortalProjectAssignmentError(
      agentError
        ? `Unable to load the assigned Agent: ${agentError.message}`
        : "The assigned Agent could not be found.",
      "database_error",
    );
  }

  const { data, error } = await supabase
    .from("project_assignments")
    .update({
      status: "inactive",
      unassigned_by: input.actor.id,
      unassignment_reason: "manual",
    })
    .eq("id", assignment.id)
    .eq("status", "active")
    .select("id, project_id, agent_user_id, status")
    .maybeSingle();

  if (error) {
    throwAssignmentWriteError(error);
  }

  if (!data) {
    throw new PortalProjectAssignmentError(
      "This project assignment is no longer active.",
      "assignment_inactive",
    );
  }

  return {
    assignmentId: data.id as string,
    projectId: project.id as string,
    externalProjectId: project.external_project_id as string,
    projectName: project.project_name as string,
    agentUserId: agent.id as string,
    agentEmail: agent.email as string,
    agentFullName: agent.full_name as string,
    status: data.status as PortalAssignmentStatus,
  };
}