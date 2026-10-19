"use client";

import * as React from "react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  CircleUserRound,
  EllipsisVertical,
  LayoutDashboard,
  LogOut,
  Rocket,
  Search,
  Settings,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { ScrambleLogo } from "@/components/branding/scramble-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

import { LayoutControls } from "../sidebar/layout-controls";

const founderNavigation = [
  {
    label: "Workspace",
    items: [
      { title: "Dashboard", href: "/dashboard/founder-dashboard", icon: LayoutDashboard },
      { title: "Applications", href: "/introductions", icon: BookOpenCheck },
      { title: "Knowledge", href: "/knowledge-base", icon: BookOpen },
      { title: "Settings", href: "/settings", icon: Settings },
    ],
  },
] as const;

export function FounderSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const path = usePathname();
  const { sidebarVariant, sidebarCollapsible, isSynced } = usePreferencesStore(
    useShallow((state) => ({
      sidebarVariant: state.sidebarVariant,
      sidebarCollapsible: state.sidebarCollapsible,
      isSynced: state.isSynced,
    })),
  );
  const variant = isSynced ? sidebarVariant : props.variant;
  const collapsible = isSynced ? sidebarCollapsible : props.collapsible;

  return (
    <Sidebar {...props} variant={variant} collapsible={collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link prefetch={false} href="/dashboard/founder-dashboard">
                <ScrambleLogo
                  markClassName="!h-6 !w-auto group-data-[collapsible=icon]:!h-4"
                  wordmarkClassName="text-base group-data-[collapsible=icon]:hidden"
                />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {founderNavigation.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild tooltip={item.title} isActive={path === item.href}>
                        <Link prefetch={false} href={item.href}>
                          <Icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <Card className="gap-0 rounded-xl border-zinc-200 bg-zinc-50/70 py-0 shadow-none group-data-[collapsible=icon]:hidden">
          <CardContent className="p-3.5">
            <div className="flex items-center gap-2.5">
              <BookOpenCheck className="size-4 shrink-0 text-zinc-600" strokeWidth={1.8} />
              <span className="font-medium text-sm">Application knowledge</span>
            </div>
            <p className="mt-2 text-muted-foreground text-xs leading-5">
              Review the context used to prepare your applications.
            </p>
            <Link
              prefetch={false}
              href="/knowledge-base"
              className="mt-3 inline-flex items-center gap-1.5 font-medium text-xs text-zinc-900 hover:text-orange-700"
            >
              Review knowledge <ArrowRight className="size-3.5" strokeWidth={1.8} />
            </Link>
          </CardContent>
        </Card>
        <div className="flex items-center justify-between px-2 group-data-[collapsible=icon]:hidden">
          <span className="text-muted-foreground text-xs">Appearance & layout</span>
          <LayoutControls />
        </div>
        <FounderAccountMenu sidebar />
      </SidebarFooter>
    </Sidebar>
  );
}

export function FounderSearchDialog() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === "j" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  const suggestions = [
    { label: "Explore programs", href: "/introductions", icon: Rocket },
    { label: "Review company knowledge", href: "/knowledge-base", icon: BookOpen },
    { label: "Update founder profile", href: "/profile", icon: CircleUserRound },
  ];

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant="link"
        className="max-w-[270px] justify-start px-0! font-normal text-muted-foreground hover:no-underline"
      >
        <Search data-icon="inline-start" />
        <span className="truncate">Search your application workspace…</span>
        <kbd className="hidden h-5 select-none items-center rounded border bg-muted px-1.5 font-medium text-[10px] sm:inline-flex">
          ⌘ J
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command>
          <CommandInput placeholder="Search programs, knowledge, and profile…" />
          <CommandList>
            <CommandEmpty>No matches found.</CommandEmpty>
            <CommandGroup heading="Scramble">
              {suggestions.map((item) => (
                <CommandItem
                  key={item.href}
                  value={item.label}
                  onSelect={() => {
                    setOpen(false);
                    router.push(item.href);
                  }}
                >
                  <item.icon /> {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

export function FounderAccountMenu({ sidebar = false }: { sidebar?: boolean }) {
  const router = useRouter();
  const [account, setAccount] = React.useState({ name: "Founder account", email: "", initials: "F" });
  React.useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user || !active) return;
      const { data: profile } = await supabase
        .from("founder_profiles")
        .select("first_name,last_name")
        .eq("user_id", auth.user.id)
        .limit(1)
        .maybeSingle();
      const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Founder account";
      if (active)
        setAccount({
          name,
          email: auth.user.email ?? "",
          initials: name
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join("")
            .toUpperCase(),
        });
    })();
    return () => {
      active = false;
    };
  }, []);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {sidebar ? (
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2 px-2 py-2 group-data-[collapsible=icon]:px-0"
          >
            <Avatar className="size-8 shrink-0 rounded-lg">
              <AvatarFallback className="rounded-lg bg-zinc-900 text-white">{account.initials}</AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-medium">{account.name}</span>
              <span className="truncate text-muted-foreground text-xs">{account.email}</span>
            </span>
            <EllipsisVertical className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="size-8 rounded-lg">
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg bg-zinc-900 text-white">{account.initials}</AvatarFallback>
            </Avatar>
            <span className="sr-only">Open founder account menu</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-60 rounded-lg" side="bottom" align="end" sideOffset={4}>
        <div className="flex items-center gap-2 px-2 py-2">
          <Avatar className="size-9 rounded-lg">
            <AvatarFallback className="rounded-lg bg-zinc-900 text-white">{account.initials}</AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{account.name}</span>
            <span className="truncate text-muted-foreground text-xs">{account.email}</span>
          </div>
          <EllipsisVertical className="size-4 text-muted-foreground" />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => router.push("/profile")}>
            <CircleUserRound /> Profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/settings")}>
            <Settings /> Settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void getSupabaseBrowserClient()
              .auth.signOut()
              .finally(() => router.replace("/scouter-founder/login"));
          }}
        >
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
