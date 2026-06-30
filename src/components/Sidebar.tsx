import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { patch, post } from "../hooks/useApi.js";
import type { Project } from "../types.js";
import type { AgentStatusMap } from "../App.js";
import { Star, EyeOff, Eye, Plus, FolderPlus, Check, X } from "lucide-react";

const AGENT_STATUS_STYLES: Record<string, string> = {
  none:    "bg-zinc-500/50",
  idle:    "bg-blue-400 shadow-[0_0_4px_rgba(96,165,250,0.4)]",
  running: "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.4)] animate-pulse",
  done:    "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.4)]",
  error:   "bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.4)]",
};

type SortKey = "name" | "created" | "updated";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name", label: "A → Z" },
  { value: "created", label: "Création" },
  { value: "updated", label: "Maj récente" },
];

// Alphabetical ascending; dates newest-first (the useful default for both).
function sortProjects(list: Project[], key: SortKey): Project[] {
  const sorted = [...list];
  if (key === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    const field = key === "created" ? "createdAt" : "updatedAt";
    sorted.sort((a, b) => (b[field] ?? "").localeCompare(a[field] ?? ""));
  }
  return sorted;
}

function SortSelect({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortKey)}
      onClick={(e) => e.stopPropagation()}
      title="Trier les projets"
      className="ml-auto rounded border border-border bg-transparent px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground focus:outline-none cursor-pointer"
    >
      {SORT_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

interface Props {
  projects: Project[];
  selected: Project | null;
  agentStatuses: AgentStatusMap;
  onSelect: (p: Project) => void;
  onScan: () => void;
  onProjectUpdate: () => void;
}

export function ProjectSidebar({
  projects,
  selected,
  agentStatuses,
  onSelect,
  onScan,
  onProjectUpdate,
}: Props) {
  const [search, setSearch] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  // Independent sort state for favorites vs the main project list, persisted.
  const [favSort, setFavSort] = useState<SortKey>(
    () => (localStorage.getItem("overlord:favSort") as SortKey) || "name"
  );
  const [projSort, setProjSort] = useState<SortKey>(
    () => (localStorage.getItem("overlord:projSort") as SortKey) || "name"
  );
  const changeFavSort = useCallback((v: SortKey) => {
    setFavSort(v);
    localStorage.setItem("overlord:favSort", v);
  }, []);
  const changeProjSort = useCallback((v: SortKey) => {
    setProjSort(v);
    localStorage.setItem("overlord:projSort", v);
  }, []);
  const [creating, setCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreateProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) return;
    setCreateError(null);
    const result = await post<Project & { error?: string }>("/projects/create", { name, initGit: true });
    if (result.error) {
      setCreateError(result.error);
      return;
    }
    setNewProjectName("");
    setCreating(false);
    onProjectUpdate();
    if (result.id) onSelect(result);
  }, [newProjectName, onProjectUpdate, onSelect]);

  const filtered = useMemo(() => {
    let list = projects;
    if (!showHidden) list = list.filter((p) => !p.hidden);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [projects, search, showHidden]);

  const favorites = useMemo(
    () => sortProjects(filtered.filter((p) => p.favorite), favSort),
    [filtered, favSort]
  );
  const others = useMemo(
    () => sortProjects(filtered.filter((p) => !p.favorite), projSort),
    [filtered, projSort]
  );

  const toggleFavorite = useCallback(
    async (e: React.MouseEvent, project: Project) => {
      e.stopPropagation();
      await patch(`/projects/${project.id}`, { favorite: !project.favorite });
      onProjectUpdate();
    },
    [onProjectUpdate]
  );

  const toggleHidden = useCallback(
    async (e: React.MouseEvent, project: Project) => {
      e.stopPropagation();
      await patch(`/projects/${project.id}`, { hidden: !project.hidden });
      onProjectUpdate();
    },
    [onProjectUpdate]
  );

  const renderProject = (p: Project) => (
    <SidebarMenuItem key={p.id} className="group/project">
      <SidebarMenuButton
        isActive={selected?.id === p.id}
        onClick={() => onSelect(p)}
        tooltip={p.path}
        className={cn(p.hidden && "opacity-40")}
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            AGENT_STATUS_STYLES[agentStatuses[p.id] ?? "none"]
          )}
        />
        <span className="truncate">{p.name}</span>
        {p.favorite && (
          <Star className="ml-auto h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400 group-hover/project:hidden" />
        )}
      </SidebarMenuButton>

      {/* Action buttons — visible on hover */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover/project:opacity-100 transition-opacity">
        <Tooltip>
          <TooltipTrigger>
            <span
              role="button"
              onClick={(e) => toggleHidden(e, p)}
              className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-sidebar-accent cursor-pointer"
            >
              {p.hidden ? (
                <Eye className="h-3 w-3 text-sidebar-foreground/50" />
              ) : (
                <EyeOff className="h-3 w-3 text-sidebar-foreground/50" />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {p.hidden ? "Afficher" : "Cacher"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger>
            <span
              role="button"
              onClick={(e) => toggleFavorite(e, p)}
              className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-sidebar-accent cursor-pointer"
            >
              <Star
                className={cn(
                  "h-3 w-3",
                  p.favorite
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-sidebar-foreground/50"
                )}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {p.favorite ? "Retirer des favoris" : "Favori"}
          </TooltipContent>
        </Tooltip>
      </div>
    </SidebarMenuItem>
  );

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center justify-between">
          <h1 className="text-[11px] font-bold tracking-[3px] text-primary">
            OVERLORD
          </h1>
          <span className="text-[10px] text-muted-foreground">
            {projects.filter((p) => !p.hidden).length}
          </span>
        </div>
        <SidebarInput
          placeholder="Rechercher..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </SidebarHeader>

      <SidebarContent>
        {favorites.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center">
              Favoris
              <SortSelect value={favSort} onChange={changeFavSort} />
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{favorites.map(renderProject)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center">
            Projets
            <SortSelect value={projSort} onChange={changeProjSort} />
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {others.map(renderProject)}
              {filtered.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  Aucun projet trouve
                </p>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2">
        {/* New project inline form */}
        {creating ? (
          <div className="flex flex-col gap-1.5">
            <Input
              autoFocus
              placeholder="my-new-project"
              value={newProjectName}
              onChange={(e) => { setNewProjectName(e.target.value); setCreateError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateProject();
                if (e.key === "Escape") { setCreating(false); setNewProjectName(""); setCreateError(null); }
              }}
              className="h-7 text-xs"
            />
            {createError && (
              <p className="text-[10px] text-destructive">{createError}</p>
            )}
            <div className="flex gap-1">
              <Button
                size="sm"
                className="flex-1 h-6 text-[11px]"
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
              >
                <Check className="h-3 w-3 mr-1" /> Create
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px]"
                onClick={() => { setCreating(false); setNewProjectName(""); setCreateError(null); }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => setCreating(true)}
          >
            <FolderPlus className="mr-2 h-3 w-3" />
            Nouveau projet
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-muted-foreground"
          onClick={() => setShowHidden((v) => !v)}
        >
          {showHidden ? (
            <Eye className="mr-2 h-3 w-3" />
          ) : (
            <EyeOff className="mr-2 h-3 w-3" />
          )}
          {showHidden ? "Masquer les caches" : "Afficher les caches"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-muted-foreground"
          onClick={onScan}
        >
          Scanner les projets
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
