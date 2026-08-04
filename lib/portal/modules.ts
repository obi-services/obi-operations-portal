export type PortalRole =
  | "admin"
  | "supervisor"
  | "agent";

export type PortalModuleKey =
  | "credits"
  | "tasks"
  | "clients"
  | "add-ons"
  | "users"
  | "notifications"
  | "automation-health"
  | "settings";

export type PortalModule = {
  key: PortalModuleKey;
  title: string;
  agentTitle?: string;
  description: string;
  agentDescription?: string;
  href: string;
  roles: PortalRole[];
};

const privilegedRoles: PortalRole[] = [
  "admin",
  "supervisor",
];

export const portalModules: PortalModule[] = [
  {
    key: "credits",
    title: "Credits",
    agentTitle: "My Credits",
    description:
      "Monitor used, remaining, low, and depleted client credits.",
    agentDescription:
      "Review credit usage and balances for your assigned clients.",
    href: "/dashboard/credits",
    roles: ["admin", "supervisor", "agent"],
  },
  {
    key: "tasks",
    title: "Tasks",
    agentTitle: "My Tasks",
    description:
      "Manage assignments, task statuses, notes, and Needs Attention requests.",
    agentDescription:
      "Review assigned tasks, update statuses, and respond to attention requests.",
    href: "/dashboard/tasks",
    roles: ["admin", "supervisor", "agent"],
  },
  {
    key: "clients",
    title: "Clients",
    description:
      "Manage client records, projects, plans, and assignments.",
    href: "/dashboard/clients",
    roles: privilegedRoles,
  },
  {
    key: "add-ons",
    title: "Add-ons",
    description:
      "Manage additional credits, rollover credits, and adjustments.",
    href: "/dashboard/add-ons",
    roles: privilegedRoles,
  },
  {
    key: "users",
    title: "Users",
    description:
      "Invite and manage administrators, supervisors, and agents.",
    href: "/dashboard/users",
    roles: privilegedRoles,
  },
  {
    key: "notifications",
    title: "Notifications",
    description:
      "Review task alerts, credit warnings, and unread notifications.",
    href: "/dashboard/notifications",
    roles: ["admin", "supervisor", "agent"],
  },
  {
    key: "automation-health",
    title: "Automation Health",
    description:
      "Monitor timer synchronization, calculations, and system activity.",
    href: "/dashboard/automation-health",
    roles: privilegedRoles,
  },
  {
    key: "settings",
    title: "Settings",
    description:
      "Configure portal rules, credit thresholds, and system preferences.",
    href: "/dashboard/settings",
    roles: privilegedRoles,
  },
];

export function getPortalModulesForRole(
  role: PortalRole,
): PortalModule[] {
  return portalModules.filter((module) =>
    module.roles.includes(role),
  );
}

export function getModuleTitle(
  module: PortalModule,
  role: PortalRole,
): string {
  if (role === "agent" && module.agentTitle) {
    return module.agentTitle;
  }

  return module.title;
}

export function getModuleDescription(
  module: PortalModule,
  role: PortalRole,
): string {
  if (
    role === "agent" &&
    module.agentDescription
  ) {
    return module.agentDescription;
  }

  return module.description;
}