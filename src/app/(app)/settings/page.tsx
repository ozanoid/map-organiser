"use client";

import { useState } from "react";
import { useCategories, useCreateCategory, useDeleteCategory } from "@/lib/hooks/use-categories";
import { useTags, useCreateTag, useDeleteTag } from "@/lib/hooks/use-tags";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Loader2, Tag, FolderOpen, Shield, Paintbrush, Sun, Moon, Monitor, Map } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { ApiKeysManager } from "@/components/settings/api-keys-manager";
import { CostTracker } from "@/components/settings/cost-tracker";
import { useMapStyle, MAP_STYLE_OPTIONS } from "@/lib/hooks/use-map-style";
import type { MapStyleKey } from "@/lib/hooks/use-map-style";

const PRESET_COLORS = [
  "#EF4444", "#F97316", "#F59E0B", "#22C55E", "#06B6D4",
  "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899", "#14B8A6",
  "#A855F7", "#6B7280",
];

export default function SettingsPage() {
  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-6 overflow-x-hidden">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your categories and tags
        </p>
      </div>

      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories" className="cursor-pointer shrink-0">
            <FolderOpen className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Categories</span>
            <span className="sm:hidden">Cats</span>
          </TabsTrigger>
          <TabsTrigger value="tags" className="cursor-pointer shrink-0">
            <Tag className="h-4 w-4 mr-1.5" />
            Tags
          </TabsTrigger>
          <TabsTrigger value="api" className="cursor-pointer shrink-0">
            <Shield className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">API & Usage</span>
            <span className="sm:hidden">API</span>
          </TabsTrigger>
          <TabsTrigger value="appearance" className="cursor-pointer shrink-0">
            <Paintbrush className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Appearance</span>
            <span className="sm:hidden">Theme</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="mt-4">
          <CategoryManager />
        </TabsContent>
        <TabsContent value="tags" className="mt-4">
          <TagManager />
        </TabsContent>
        <TabsContent value="api" className="mt-4 space-y-6">
          <ApiKeysManager />
          <Separator />
          <CostTracker />
        </TabsContent>
        <TabsContent value="appearance" className="mt-4">
          <AppearanceSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CategoryManager() {
  const { data: categories = [], isLoading } = useCategories();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#059669");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    createCategory.mutate(
      { name: newName.trim(), color: newColor },
      {
        onSuccess: () => {
          toast.success("Category created");
          setNewName("");
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  function handleDelete(id: string, name: string, isDefault: boolean) {
    if (isDefault) {
      toast.error("Default categories cannot be deleted");
      return;
    }
    if (!confirm(`Delete category "${name}"? Places in this category will become uncategorized.`)) return;
    deleteCategory.mutate(id, {
      onSuccess: () => toast.success("Category deleted"),
      onError: (err) => toast.error(err.message),
    });
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      {/* Create form */}
      <form onSubmit={handleCreate} className="flex gap-2 items-end">
        <div className="flex-1">
          <Input
            placeholder="New category name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-9 text-sm"
          />
        </div>
        <div className="flex gap-1">
          {PRESET_COLORS.slice(0, 6).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setNewColor(c)}
              className="h-6 w-6 rounded-full cursor-pointer shrink-0"
              style={{
                backgroundColor: c,
                outline: newColor === c ? "2px solid currentColor" : "none",
                outlineOffset: "2px",
              }}
            />
          ))}
        </div>
        <Button type="submit" size="sm" className="h-9 cursor-pointer" disabled={!newName.trim() || createCategory.isPending}>
          {createCategory.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </form>

      <Separator />

      {/* Category list */}
      <div className="space-y-1">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 group"
          >
            <div className="flex items-center gap-3">
              <span
                className="h-4 w-4 rounded-full shrink-0"
                style={{ backgroundColor: cat.color }}
              />
              <span className="text-sm">{cat.name}</span>
              {cat.is_default && (
                <span className="text-[10px] text-muted-foreground bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                  default
                </span>
              )}
            </div>
            {!cat.is_default && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 cursor-pointer text-red-500 hover:text-red-600"
                onClick={() => handleDelete(cat.id, cat.name, cat.is_default)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TagManager() {
  const { data: tags = [], isLoading } = useTags();
  const createTag = useCreateTag();
  const deleteTag = useDeleteTag();
  const [newName, setNewName] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    createTag.mutate(newName.trim(), {
      onSuccess: () => {
        toast.success("Tag created");
        setNewName("");
      },
      onError: (err) => toast.error(err.message),
    });
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete tag "${name}"?`)) return;
    deleteTag.mutate(id, {
      onSuccess: () => toast.success("Tag deleted"),
      onError: (err) => toast.error(err.message),
    });
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      {/* Create form */}
      <form onSubmit={handleCreate} className="flex gap-2">
        <Input
          placeholder="New tag name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="h-9 text-sm flex-1"
        />
        <Button type="submit" size="sm" className="h-9 cursor-pointer" disabled={!newName.trim() || createTag.isPending}>
          {createTag.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </form>

      <Separator />

      {/* Tag list */}
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No tags yet. Create your first tag above.
        </p>
      ) : (
        <div className="space-y-1">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 group"
            >
              <span className="text-sm">{tag.name}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 cursor-pointer text-red-500 hover:text-red-600"
                onClick={() => handleDelete(tag.id, tag.name)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const { mapStyle, setMapStyle } = useMapStyle();
  const [mounted, setMounted] = useState(false);

  useState(() => { setMounted(true); });

  if (!mounted) return null;

  return (
    <div className="space-y-6">
      {/* Theme */}
      <div>
        <label className="text-sm font-medium mb-3 block">Theme</label>
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme(opt.value)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border cursor-pointer transition-colors duration-200 ${
                  active
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                    : "border-input hover:border-gray-300 dark:hover:border-gray-600 text-muted-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-xs font-medium">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Map Style */}
      <div>
        <label className="text-sm font-medium mb-3 block">
          <Map className="h-4 w-4 inline mr-1.5 -mt-0.5" />
          Map Style
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {MAP_STYLE_OPTIONS.map((opt) => {
            const active = mapStyle === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMapStyle(opt.value as MapStyleKey)}
                className={`flex flex-col items-start p-3 rounded-lg border cursor-pointer transition-colors duration-200 ${
                  active
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                    : "border-input hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">{opt.description}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
