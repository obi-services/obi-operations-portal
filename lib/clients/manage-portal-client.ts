import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type PortalClientStatus = "active" | "inactive" | "cancelled";

export type ClientManagementActor = {
  id: string;
  email: string;
  role: "admin" | "supervisor";
};

export type CreatePortalClientInput = {
  clientCode: string;
  clientName: string;
  status: string;
  notes: string;
  actor: ClientManagementActor;
};

export type UpdatePortalClientInput = {
  clientId: string;
  clientName: string;
  status: string;
  notes: string;
  actor: ClientManagementActor;
};

export type PortalClientMutationResult = {
  clientId: string;
  clientCode: string;
  clientName: string;
  status: PortalClientStatus;
};

export class PortalClientError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "client_exists"
      | "client_not_found"
      | "database_error",
  ) {
    super(message);
    this.name = "PortalClientError";
  }
}

function normalizeClientCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeClientName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeNotes(value: string): string | null {
  const notes = value.trim();

  return notes ? notes : null;
}

function validateStatus(value: string): PortalClientStatus {
  if (
    value !== "active" &&
    value !== "inactive" &&
    value !== "cancelled"
  ) {
    throw new PortalClientError(
      "Select a valid client status.",
      "invalid_input",
    );
  }

  return value;
}

function validateClientCode(value: string): string {
  const clientCode = normalizeClientCode(value);

  if (clientCode.length < 2 || clientCode.length > 40) {
    throw new PortalClientError(
      "Client ID must contain between 2 and 40 characters.",
      "invalid_input",
    );
  }

  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(clientCode)) {
    throw new PortalClientError(
      "Client ID may contain letters, numbers, hyphens, and underscores only.",
      "invalid_input",
    );
  }

  return clientCode;
}

function validateClientName(value: string): string {
  const clientName = normalizeClientName(value);

  if (clientName.length < 2 || clientName.length > 160) {
    throw new PortalClientError(
      "Client name must contain between 2 and 160 characters.",
      "invalid_input",
    );
  }

  return clientName;
}

function validateNotes(value: string): string | null {
  const notes = normalizeNotes(value);

  if (notes && notes.length > 2000) {
    throw new PortalClientError(
      "Client notes cannot exceed 2,000 characters.",
      "invalid_input",
    );
  }

  return notes;
}

function validateUuid(value: string): string {
  const clientId = value.trim();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      clientId,
    )
  ) {
    throw new PortalClientError(
      "The client record identifier is invalid.",
      "invalid_input",
    );
  }

  return clientId;
}

export async function createPortalClient(
  supabase: SupabaseClient,
  input: CreatePortalClientInput,
): Promise<PortalClientMutationResult> {
  const clientCode = validateClientCode(input.clientCode);
  const clientName = validateClientName(input.clientName);
  const status = validateStatus(input.status);
  const notes = validateNotes(input.notes);

  const { data: existingClient, error: existingClientError } = await supabase
    .from("clients")
    .select("id, client_code")
    .ilike("client_code", clientCode)
    .maybeSingle();

  if (existingClientError) {
    throw new PortalClientError(
      `Unable to check the client ID: ${existingClientError.message}`,
      "database_error",
    );
  }

  if (existingClient) {
    throw new PortalClientError(
      `Client ID ${clientCode} already exists.`,
      "client_exists",
    );
  }

  const { data, error } = await supabase
    .from("clients")
    .insert({
      client_code: clientCode,
      client_name: clientName,
      status,
      notes,
    })
    .select("id, client_code, client_name, status")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new PortalClientError(
        `Client ID ${clientCode} already exists.`,
        "client_exists",
      );
    }

    throw new PortalClientError(
      `Unable to create the client: ${error.message}`,
      "database_error",
    );
  }

  return {
    clientId: data.id as string,
    clientCode: data.client_code as string,
    clientName: data.client_name as string,
    status: data.status as PortalClientStatus,
  };
}

export async function updatePortalClient(
  supabase: SupabaseClient,
  input: UpdatePortalClientInput,
): Promise<PortalClientMutationResult> {
  const clientId = validateUuid(input.clientId);
  const clientName = validateClientName(input.clientName);
  const status = validateStatus(input.status);
  const notes = validateNotes(input.notes);

  const { data: existingClient, error: existingClientError } = await supabase
    .from("clients")
    .select("id, client_code")
    .eq("id", clientId)
    .maybeSingle();

  if (existingClientError) {
    throw new PortalClientError(
      `Unable to load the client record: ${existingClientError.message}`,
      "database_error",
    );
  }

  if (!existingClient) {
    throw new PortalClientError(
      "The client record could not be found.",
      "client_not_found",
    );
  }

  const { data, error } = await supabase
    .from("clients")
    .update({
      client_name: clientName,
      status,
      notes,
    })
    .eq("id", clientId)
    .select("id, client_code, client_name, status")
    .single();

  if (error) {
    throw new PortalClientError(
      `Unable to update the client: ${error.message}`,
      "database_error",
    );
  }

  return {
    clientId: data.id as string,
    clientCode: data.client_code as string,
    clientName: data.client_name as string,
    status: data.status as PortalClientStatus,
  };
}
