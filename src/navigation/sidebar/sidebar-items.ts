import {
  Bell,
  CheckSquare,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  PlugZap,
  Plus,
  TableProperties,
  Target,
  UserRound,
  UsersRound,
} from "lucide-react";

export type NavBadge = "new" | "soon";

export interface NavSubItem {
  id: string;
  title: string;
  url: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

interface NavItemBase {
  id: string;
  title: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

export interface NavMainLinkItem extends NavItemBase {
  url: string;
  subItems?: never;
}

export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 3,
    label: "Workspace",
    items: [
      { id: "riser-dashboard", title: "Dashboard", url: "/dashboard/riser-dashboard", icon: LayoutDashboard },
      { id: "riser-cap-table", title: "Cap Table", url: "/dashboard/riser-cap-table", icon: TableProperties },
      { id: "riser-goals", title: "Goals", url: "/dashboard/riser-goals", icon: Target },
      {
        id: "riser-company-journey",
        title: "Company Journey",
        url: "/dashboard/riser-company-journey",
        icon: GitBranch,
      },
      { id: "riser-users", title: "Users", url: "/dashboard/riser-users", icon: UsersRound },
    ],
  },
  {
    id: 4,
    label: "Work",
    items: [
      { id: "riser-task-create", title: "New Task", url: "/dashboard/riser-task-create", icon: Plus },
      { id: "riser-tasks", title: "Tasks", url: "/dashboard/riser-tasks", icon: CheckSquare },
      { id: "riser-integrations", title: "Integrations", url: "/dashboard/riser-integrations", icon: PlugZap },
      {
        id: "riser-notifications",
        title: "Notifications",
        url: "/dashboard/riser-notifications",
        icon: Bell,
      },
    ],
  },
  {
    id: 5,
    label: "Account",
    items: [
      { id: "riser-profile", title: "Profile", url: "/dashboard/riser-profile", icon: UserRound },
      { id: "riser-permissions", title: "Roles & access", url: "/dashboard/riser-users", icon: KeyRound },
    ],
  },
];
