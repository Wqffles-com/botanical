"use client";

import { Search } from "lucide-react";
import type { ComponentProps } from "react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@botanical/ui/components/input-group";

/** Outline search field. Matches the sidebar Search button so every filter looks the same. */
export function SearchInput({ className, ...props }: ComponentProps<typeof InputGroupInput>) {
  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput type="search" {...props} />
    </InputGroup>
  );
}
