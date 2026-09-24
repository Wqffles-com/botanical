"use client";

import type { Agent, Chat } from "@botanical/core";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { ChatListSkeleton } from "@/components/chat/skeletons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { chatsByAgent } from "@/lib/chat-groups";
import { errorText } from "@/lib/errors";
import { relativeTime } from "@/lib/format";

export function ChatList({
  chats,
  agents,
  activeChatId,
  loading,
}: {
  chats: Chat[];
  agents: Agent[];
  activeChatId?: string;
  loading?: boolean;
}) {
  const router = useRouter();
  const { renameChat, deleteChat } = useWorkspace();
  const [rename, setRename] = useState<Chat | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [remove, setRemove] = useState<Chat | null>(null);
  const groups = chatsByAgent(chats, agents);

  if (loading) return <ChatListSkeleton />;

  return (
    <>
      {groups.length === 0 ? (
        <p className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">No chats yet.</p>
      ) : (
        groups.map((group) => {
          const identity = group.agent as (Agent & { icon?: string; color?: string }) | null;
          return (
            <SidebarGroup key={group.agent?.id ?? "unknown"}>
              <SidebarGroupLabel className="flex items-center gap-2">
                {group.agent ? (
                  <AgentAvatar
                    name={group.agent.name}
                    icon={identity?.icon}
                    color={identity?.color}
                    size="sm"
                  />
                ) : null}
                <span className="truncate">{group.agent?.name ?? "Unknown agent"}</span>
              </SidebarGroupLabel>
              {group.agent ? (
                <SidebarGroupAction
                  title="New chat with this agent"
                  onClick={() => router.push(`/chats/new?agentId=${encodeURIComponent(group.agent!.id)}`)}
                >
                  <Plus />
                </SidebarGroupAction>
              ) : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.chats.map((chat) => {
                    const active = chat.id === activeChatId;
                    return (
                      <SidebarMenuItem key={chat.id}>
                        <SidebarMenuButton
                          isActive={active}
                          tooltip={chat.title}
                          render={<Link href={`/chats/${chat.id}`} data-testid="chat-row" />}
                        >
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{chat.title}</span>
                            <span className="truncate text-[11px] font-normal text-muted-foreground">
                              {relativeTime(chat.updatedAt)}
                            </span>
                          </span>
                        </SidebarMenuButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <SidebarMenuAction
                                showOnHover
                                aria-label={`Chat actions for ${chat.title}`}
                              />
                            }
                          >
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="right">
                            <DropdownMenuItem
                              onClick={() => {
                                setRename(chat);
                                setRenameValue(chat.title);
                              }}
                            >
                              <Pencil />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setRemove(chat)}>
                              <Trash2 />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })
      )}

      <Dialog open={Boolean(rename)} onOpenChange={(open) => !open && setRename(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>The agent for this thread stays the same.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRename(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!rename || !renameValue.trim()) return;
                try {
                  await renameChat(rename.id, renameValue.trim());
                  setRename(null);
                } catch (err) {
                  toast.error(errorText(err));
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(remove)} onOpenChange={(open) => !open && setRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete chat</DialogTitle>
            <DialogDescription>
              {remove ? `Delete “${remove.title}”? Messages in this thread go with it.` : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!remove) return;
                const id = remove.id;
                try {
                  await deleteChat(id);
                  setRemove(null);
                  if (activeChatId === id) router.push("/chats/new");
                } catch (err) {
                  toast.error(errorText(err));
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
