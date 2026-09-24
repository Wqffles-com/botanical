"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { AgentAvatar } from "@/components/agent-avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AgentColor } from "@/lib/agent-colors";
import { searchAgentIcons, type AgentIconName } from "@/lib/agent-icons";

export function AgentIconPicker({
  value,
  color,
  onChange,
  disabled,
}: {
  value: AgentIconName | string;
  color: AgentColor;
  onChange: (icon: AgentIconName) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const icons = useMemo(() => searchAgentIcons(query), [query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full justify-start gap-3 px-2.5"
          />
        }
      >
        <AgentAvatar icon={value} color={color} name={value} size="sm" />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium">{value}</span>
          <span className="block truncate text-xs text-muted-foreground">Lucide icon</span>
        </span>
        <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search icons…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-80">
            <CommandEmpty>No icons match.</CommandEmpty>
            <CommandGroup heading={`${icons.length} icons`}>
              <div className="grid grid-cols-8 gap-1 p-1">
                {icons.map((name) => {
                  const selected = name === value;
                  return (
                    <CommandItem
                      key={name}
                      value={name}
                      data-checked={selected || undefined}
                      onSelect={() => {
                        onChange(name);
                        setOpen(false);
                        setQuery("");
                      }}
                      className="flex h-9 items-center justify-center rounded-md p-0 **:data-[slot=command-shortcut]:hidden [&_svg.ml-auto]:hidden"
                      title={name}
                    >
                      <AgentAvatar icon={name} color={color} name={name} size="sm" />
                      <span className="sr-only">{name}</span>
                    </CommandItem>
                  );
                })}
              </div>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
