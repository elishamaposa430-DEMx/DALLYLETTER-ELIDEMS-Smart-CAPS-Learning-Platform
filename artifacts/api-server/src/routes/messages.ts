// Messages routes — group and private chat, including voice notes
import { Router, type IRouter } from "express";
import { eq, and, isNull, or, inArray } from "drizzle-orm";
import multer from "multer";
import { db, messagesTable, activityLogTable, studyGroupMembersTable, studyGroupsTable, contentFlagsTable, auditLogsTable } from "@workspace/db";
import {
  ListMessagesQueryParams,
  SendMessageBody,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth-middleware";
import { getAIProvider } from "../lib/ai-provider";
import { createMediaStorageKey, ensureMediaDirectory, getMediaDirectory, isAllowedMediaType, MAX_MEDIA_SIZE_BYTES } from "../lib/media-storage";

const router: IRouter = Router();

const voiceUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, callback) => {
      try { await ensureMediaDirectory(); callback(null, getMediaDirectory()); } catch (error) { callback(error as Error, ""); }
    },
    filename: (_req, _file, callback) => callback(null, createMediaStorageKey()),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, isAllowedMediaType(file.mimetype) && file.mimetype.startsWith("audio/")),
});

async function canAccessGroup(groupId: number, userId: number, role: string): Promise<boolean> {
  const [group] = await db.select({ id: studyGroupsTable.id }).from(studyGroupsTable).where(eq(studyGroupsTable.id, groupId));
  if (!group) return false;
  if (role === "teacher" || role === "owner") return true;
  const [membership] = await db.select({ id: studyGroupMembersTable.id })
    .from(studyGroupMembersTable)
    .where(and(eq(studyGroupMembersTable.groupId, groupId), eq(studyGroupMembersTable.userId, userId)));
  return Boolean(membership);
}

router.post("/messages/media", requireAuth, (req, res): void => {
  voiceUpload.single("file")(req, res, (error) => {
    if (error || !req.file) { res.status(400).json({ error: "A supported audio file up to 10 MB is required" }); return; }
    res.status(201).json({
      mediaUrl: `/api/lessons/media/${req.file.filename}?type=${encodeURIComponent(req.file.mimetype)}`,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
  });
});

// GET /messages — List messages filtered by groupId or recipientId
router.get("/messages", requireAuth, async (req, res): Promise<void> => {
  const queryParams = ListMessagesQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const { groupId, recipientId } = queryParams.data;
  const currentUser = req.currentUser!;

  let messages;
  if (groupId != null) {
    if (!(await canAccessGroup(groupId, currentUser.id, currentUser.role))) {
      res.status(403).json({ error: "You must be a group member to view its messages" });
      return;
    }
    // Group messages
    messages = await db.select().from(messagesTable)
      .where(eq(messagesTable.groupId, groupId))
      .orderBy(messagesTable.createdAt);
  } else if (recipientId != null) {
    // Private messages between current user and recipient
    messages = await db.select().from(messagesTable)
      .where(
        or(
          and(eq(messagesTable.senderId, currentUser.id), eq(messagesTable.recipientId, recipientId)),
          and(eq(messagesTable.senderId, recipientId), eq(messagesTable.recipientId, currentUser.id))
        )
      )
      .orderBy(messagesTable.createdAt);
  } else {
    const memberships = await db.select({ groupId: studyGroupMembersTable.groupId })
      .from(studyGroupMembersTable)
      .where(eq(studyGroupMembersTable.userId, currentUser.id));
    const groupIds = memberships.map(({ groupId }) => groupId);
    messages = groupIds.length === 0
      ? []
      : await db.select().from(messagesTable)
        .where(and(isNull(messagesTable.recipientId), inArray(messagesTable.groupId, groupIds)))
        .orderBy(messagesTable.createdAt);
  }

  res.json(messages.map(m => ({ ...m, createdAt: m.createdAt.toISOString() })));
});

// POST /messages — Send a message
router.post("/messages", requireAuth, async (req, res): Promise<void> => {
  const currentUser = req.currentUser!;

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.groupId != null && !(await canAccessGroup(parsed.data.groupId, currentUser.id, currentUser.role))) {
    res.status(403).json({ error: "You must be a group member to post messages" });
    return;
  }

  if (parsed.data.parentMessageId != null) {
    if (parsed.data.groupId == null) {
      res.status(400).json({ error: "Replies must belong to a group" });
      return;
    }
    const [parent] = await db.select({
      id: messagesTable.id,
      groupId: messagesTable.groupId,
      recipientId: messagesTable.recipientId,
    }).from(messagesTable).where(eq(messagesTable.id, parsed.data.parentMessageId));
    if (!parent || parent.groupId !== parsed.data.groupId || parent.recipientId != null) {
      res.status(400).json({ error: "Parent message must belong to the selected group" });
      return;
    }
  }

  const [message] = await db.insert(messagesTable).values({
    ...parsed.data,
    senderId: currentUser.id,
    senderName: currentUser.name,
    senderRole: currentUser.role,
  }).returning();

  // Log activity for group messages
  if (message.groupId != null) {
    await db.insert(activityLogTable).values({
      type: "message_sent",
      description: `${currentUser.name} sent a message in a group`,
      actorName: currentUser.name,
    });
  }

  res.status(201).json({ ...message, createdAt: message.createdAt.toISOString() });
});

router.post("/messages/:id/report", requireAuth, async (req, res): Promise<void> => {
  const messageId = Number(req.params.id);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!Number.isInteger(messageId) || messageId <= 0 || reason.length < 3 || reason.length > 500) {
    res.status(400).json({ error: "A valid message id and a reason between 3 and 500 characters are required" });
    return;
  }

  const [message] = await db.select().from(messagesTable).where(eq(messagesTable.id, messageId));
  if (!message || message.groupId == null || !(await canAccessGroup(message.groupId, req.currentUser!.id, req.currentUser!.role))) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  let severity = "medium";
  let detectedBy = "user";
  let storedReason = reason;
  try {
    const ai = await getAIProvider();
    const moderation = await ai.moderateContent(message.content);
    if (moderation.flagged) {
      severity = moderation.severity;
      detectedBy = `${ai.name}:user`;
      storedReason = `${reason} AI assessment: ${moderation.reason ?? "Potential policy concern"}`.slice(0, 500);
    }
  } catch {
    // Preserve the user report without inventing an AI result when the provider is unavailable.
  }

  const [flag] = await db.insert(contentFlagsTable).values({
    contentType: "message",
    contentId: message.id,
    contentText: message.content.slice(0, 500),
    reason: storedReason,
    severity,
    detectedBy,
    status: "pending",
  }).returning();

  await db.insert(auditLogsTable).values({
    action: `Reported group message #${message.id}`,
    category: "moderation",
    performedBy: req.currentUser!.id,
    targetType: "message",
    targetId: message.id,
    details: JSON.stringify({ flagId: flag.id, reason }),
  });

  res.status(201).json(flag);
});

export default router;
