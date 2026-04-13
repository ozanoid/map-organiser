"use client";

import { useState, useRef } from "react";
import { useTags, useCreateTag } from "@/lib/hooks/use-tags";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { toast } from "sonner";

interface InlineTagInputProps {
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
}

export function InlineTagInput({ selectedTagIds, onChange }: InlineTagInputProps) {
  const { data: allTags = [] } = useTags();
  const createTag = useCreateTag();
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedTags = allTags.filter((t) => selectedTagIds.includes(t.id));

  const suggestions = input.trim()
    ? allTags.filter(
        (t) =>
          t.name.toLowerCase().includes(input.toLowerCase()) &&
          !selectedTagIds.includes(t.id)
      )
    : [];

  const exactMatch = allTags.find(
    (t) => t.name.toLowerCase() === input.trim().toLowerCase()
  );

  function addTag(tagId: string) {
    if (!selectedTagIds.includes(tagId)) {
      onChange([...selectedTagIds, tagId]);
    }
    setInput("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function removeTag(tagId: string) {
    onChange(selectedTagIds.filter((id) => id !== tagId));
  }

  async function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;

      if (exactMatch) {
        addTag(exactMatch.id);
      } else {
        // Create new tag
        createTag.mutate(trimmed, {
          onSuccess: (tag) => {
            addTag(tag.id);
            toast.success(`Tag "${tag.name}" created`);
          },
          onError: (err) => toast.error(err.message),
        });
      }
    }

    if (e.key === "Backspace" && !input && selectedTagIds.length > 0) {
      removeTag(selectedTagIds[selectedTagIds.length - 1]);
    }
  }

  return (
    <div className="space-y-2">
      {/* Selected tags */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedTags.map((tag) => (
            <Badge
              key={tag.id}
              variant="secondary"
              className="gap-1 text-xs pr-1 cursor-default"
            >
              {tag.name}
              <button
                type="button"
                onClick={() => removeTag(tag.id)}
                className="cursor-pointer hover:text-red-500 transition-colors p-1 -mr-0.5"
                aria-label={`Remove tag ${tag.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Input with suggestions */}
      <div className="relative">
        <Input
          ref={inputRef}
          placeholder="Type to add tags..."
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          className="h-8 text-sm"
        />

        {showSuggestions && input.trim() && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-10 max-h-32 overflow-y-auto">
            {suggestions.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addTag(tag.id)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer"
              >
                {tag.name}
              </button>
            ))}
            {!exactMatch && input.trim() && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  createTag.mutate(input.trim(), {
                    onSuccess: (tag) => {
                      addTag(tag.id);
                      toast.success(`Tag "${tag.name}" created`);
                    },
                    onError: (err) => toast.error(err.message),
                  });
                }}
                className="w-full text-left px-3 py-1.5 text-sm text-emerald-600 hover:bg-emerald-50 cursor-pointer"
              >
                + Create &quot;{input.trim()}&quot;
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
