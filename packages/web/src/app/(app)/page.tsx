"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { sortChats } from "@/lib/chat-groups";

export default function HomePage() {
  const router = useRouter();
  const { chats, status } = useWorkspace();

  useEffect(() => {
    if (status !== "ready") return;
    const newest = sortChats(chats)[0];
    router.replace(newest ? `/chats/${newest.id}` : "/chats/new");
  }, [chats, router, status]);

  return null;
}
