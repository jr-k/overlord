import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useApi, post, patch } from "../hooks/useApi.js";
import type { Project, Todo } from "../types.js";
import { Play, Trash2, Check, Plus } from "lucide-react";

interface Props {
  project: Project;
  onSendToChat: (message: string) => void;
}

export function TodosTab({ project, onSendToChat }: Props) {
  const { data: todos, refetch } = useApi<Todo[]>(`/todos/${project.id}`);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [showForm, setShowForm] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!newTitle.trim()) return;
    await post("/todos", {
      projectId: project.id,
      title: newTitle.trim(),
      description: newDesc.trim() || null,
    });
    setNewTitle("");
    setNewDesc("");
    setShowForm(false);
    refetch();
  }, [newTitle, newDesc, project.id, refetch]);

  const handleToggle = useCallback(
    async (todo: Todo) => {
      await patch(`/todos/${todo.id}`, { done: !todo.done });
      refetch();
    },
    [refetch]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      await fetch(`/api/todos/${id}`, { method: "DELETE" });
      refetch();
    },
    [refetch]
  );

  const handleLaunch = useCallback(
    (todo: Todo) => {
      const message = todo.description
        ? `${todo.title}\n\n${todo.description}`
        : todo.title;
      onSendToChat(message);
    },
    [onSendToChat]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  };

  const pending = todos?.filter((t) => !t.done) ?? [];
  const done = todos?.filter((t) => t.done) ?? [];

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      {/* Header + Add button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Todos ({pending.length} pending)
        </h3>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          onClick={() => setShowForm((v) => !v)}
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>

      {/* New todo form */}
      {showForm && (
        <Card>
          <CardContent className="pt-4 flex flex-col gap-3">
            <Input
              placeholder="Task title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <Textarea
              placeholder="Description / details (optional)..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="min-h-[80px] resize-none"
            />
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!newTitle.trim()}
              >
                Add
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Pending todos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pending ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {pending.length === 0 ? (
              <p className="text-sm italic text-muted-foreground py-8 text-center">
                No tasks. Add ideas and todos for this project.
              </p>
            ) : (
              pending.map((todo) => (
                <Card key={todo.id} className="group">
                  <CardContent className="flex items-start gap-3 py-3 px-4">
                    <button
                      onClick={() => handleToggle(todo)}
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border hover:bg-accent"
                    >
                      {todo.done && <Check className="h-3 w-3" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{todo.title}</div>
                      {todo.description && (
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                          {todo.description}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 gap-1.5 px-2.5 text-xs"
                        onClick={() => handleLaunch(todo)}
                        title="Send to chat"
                      >
                        <Play className="h-3 w-3" />
                        Start
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(todo.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </CardContent>
        </Card>

        {/* Done todos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Done ({done.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {done.length === 0 ? (
              <p className="text-sm italic text-muted-foreground py-8 text-center">
                No completed tasks yet.
              </p>
            ) : (
              done.map((todo) => (
                <Card key={todo.id} className="group opacity-50">
                  <CardContent className="flex items-start gap-3 py-3 px-4">
                    <button
                      onClick={() => handleToggle(todo)}
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-primary/20"
                    >
                      <Check className="h-3 w-3 text-primary" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm line-through">{todo.title}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
                      onClick={() => handleDelete(todo.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
