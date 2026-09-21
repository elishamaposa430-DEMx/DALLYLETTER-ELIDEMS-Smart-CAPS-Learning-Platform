import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { assignmentsTable, assignmentSubmissionsTable } from "@workspace/db/schema";
import { eq, desc, and, or, isNull } from "drizzle-orm";
import { requireAuth } from "../lib/auth-middleware";
import { createMediaStorageKey, ensureMediaDirectory, getMediaDirectory, isAllowedMediaType, MAX_MEDIA_SIZE_BYTES } from "../lib/media-storage";

const router = Router();
const materialUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, callback) => {
      try { await ensureMediaDirectory(); callback(null, getMediaDirectory()); } catch (error) { callback(error as Error, ""); }
    },
    filename: (_req, _file, callback) => callback(null, createMediaStorageKey()),
  }),
  limits: { fileSize: MAX_MEDIA_SIZE_BYTES },
  fileFilter: (_req, file, callback) => callback(null, isAllowedMediaType(file.mimetype)),
});

function isVisibleToStudent(assignment: { status: string; grade: string | null }, grade: string | null): boolean {
  return assignment.status === "active" && (assignment.grade == null || (grade != null && assignment.grade === grade));
}

function isValidDueDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function parseTotalMarks(value: unknown): number | null {
  const marks = typeof value === "number" ? value : Number(value);
  return Number.isInteger(marks) && marks > 0 && marks <= 10000 ? marks : null;
}

function normalizeAttachmentUrl(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

router.post("/material", requireAuth, (req, res): void => {
  if (!req.currentUser || !["student", "teacher", "owner"].includes(req.currentUser.role)) { res.status(403).json({ error: "Assignment access required" }); return; }
  materialUpload.single("file")(req, res, (error) => {
    if (error) { res.status(400).json({ error: "A supported material file up to 250 MB is required" }); return; }
    if (!req.file) { res.status(400).json({ error: "A supported material file is required" }); return; }
    res.status(201).json({ attachmentUrl: `/api/lessons/media/${req.file.filename}?type=${encodeURIComponent(req.file.mimetype)}`, fileName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size });
  });
});

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (!["student", "teacher", "owner"].includes(user.role)) { res.status(403).json({ error: "Assignment access required" }); return; }
  let rows;
  if (user.role === "owner" || user.role === "teacher") {
    rows = await db.select().from(assignmentsTable).orderBy(desc(assignmentsTable.createdAt));
  } else {
    rows = await db.select().from(assignmentsTable)
      .where(and(
        eq(assignmentsTable.status, "active"),
        or(isNull(assignmentsTable.grade), eq(assignmentsTable.grade, user.grade ?? "")),
      ))
      .orderBy(desc(assignmentsTable.createdAt));
  }
  res.json(rows);
});

router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (!["student", "teacher", "owner"].includes(user.role)) { res.status(403).json({ error: "Assignment access required" }); return; }
  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, parseInt(String(req.params.id))));
  if (!assignment) { res.status(404).json({ error: "Not found" }); return; }
  if (user.role === "student" && !isVisibleToStudent(assignment, user.grade)) { res.status(404).json({ error: "Not found" }); return; }
    if (user.role === "teacher" && assignment.teacherId !== user.id) { res.status(403).json({ error: "You can only view your own assignments" }); return; }
  const submissions = user.role === "student"
    ? await db.select().from(assignmentSubmissionsTable).where(and(eq(assignmentSubmissionsTable.assignmentId, assignment.id), eq(assignmentSubmissionsTable.studentId, user.id)))
    : await db.select().from(assignmentSubmissionsTable).where(eq(assignmentSubmissionsTable.assignmentId, assignment.id));
  res.json({ ...assignment, submissions });
});

router.post("/", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (user.role !== "teacher" && user.role !== "owner") { res.status(403).json({ error: "Forbidden" }); return; }
  const { title, description, subject, grade, dueDate, totalMarks, attachmentUrl } = req.body;
  const parsedMarks = parseTotalMarks(totalMarks ?? 100);
  const normalizedAttachmentUrl = normalizeAttachmentUrl(attachmentUrl);
  if (attachmentUrl != null && normalizedAttachmentUrl == null) {
    res.status(400).json({ error: "attachmentUrl must be a valid http(s) URL" }); return;
  }
  if (typeof title !== "string" || !title.trim() || typeof subject !== "string" || !subject.trim() || !isValidDueDate(dueDate) || parsedMarks == null) {
    res.status(400).json({ error: "title, subject, valid dueDate, and totalMarks between 1 and 10000 are required" }); return;
  }
  const [row] = await db.insert(assignmentsTable).values({
    title: title.trim(), description, subject: subject.trim(), grade: typeof grade === "string" && grade.trim() ? grade.trim() : null, dueDate, totalMarks: parsedMarks,
    teacherId: user.id, teacherName: user.name, attachmentUrl: normalizedAttachmentUrl,
  }).returning();
  res.status(201).json(row);
});

router.put("/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (user.role !== "teacher" && user.role !== "owner") { res.status(403).json({ error: "Forbidden" }); return; }
  const assignmentId = parseInt(String(req.params.id));
  const [existing] = await db.select({ teacherId: assignmentsTable.teacherId }).from(assignmentsTable).where(eq(assignmentsTable.id, assignmentId));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (user.role !== "owner" && existing.teacherId !== user.id) { res.status(403).json({ error: "You can only edit your own assignments" }); return; }
  const { title, description, subject, grade, dueDate, totalMarks, status, attachmentUrl } = req.body;
  const parsedMarks = parseTotalMarks(totalMarks);
  const normalizedAttachmentUrl = normalizeAttachmentUrl(attachmentUrl);
  if (attachmentUrl != null && normalizedAttachmentUrl == null) {
    res.status(400).json({ error: "attachmentUrl must be a valid http(s) URL" }); return;
  }
  if (typeof title !== "string" || !title.trim() || typeof subject !== "string" || !subject.trim() || !isValidDueDate(dueDate) || parsedMarks == null || (status !== "active" && status !== "archived")) {
    res.status(400).json({ error: "title, subject, valid dueDate, status, and totalMarks between 1 and 10000 are required" }); return;
  }
  const [row] = await db.update(assignmentsTable).set({ title: title.trim(), description, subject: subject.trim(), grade: typeof grade === "string" && grade.trim() ? grade.trim() : null, dueDate, totalMarks: parsedMarks, status, attachmentUrl: normalizedAttachmentUrl })
    .where(eq(assignmentsTable.id, assignmentId)).returning();
  res.json(row);
});

router.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (user.role !== "owner") { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(assignmentsTable).where(eq(assignmentsTable.id, parseInt(String(req.params.id))));
  res.json({ ok: true });
});

router.get("/:id/submissions", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (!["student", "teacher", "owner"].includes(user.role)) { res.status(403).json({ error: "Assignment access required" }); return; }
  const assignmentId = parseInt(String(req.params.id));
  if (user.role === "student") {
    const [assignment] = await db.select({ status: assignmentsTable.status, grade: assignmentsTable.grade }).from(assignmentsTable).where(eq(assignmentsTable.id, assignmentId));
    if (!assignment || !isVisibleToStudent(assignment, user.grade)) { res.status(404).json({ error: "Not found" }); return; }
    const [sub] = await db.select().from(assignmentSubmissionsTable)
      .where(and(eq(assignmentSubmissionsTable.assignmentId, assignmentId), eq(assignmentSubmissionsTable.studentId, user.id)));
    res.json(sub ? [sub] : []); return;
  }
  const [assignment] = await db.select({ teacherId: assignmentsTable.teacherId }).from(assignmentsTable).where(eq(assignmentsTable.id, assignmentId));
  if (!assignment) { res.status(404).json({ error: "Not found" }); return; }
  if (user.role !== "owner" && (user.role !== "teacher" || assignment.teacherId !== user.id)) {
    res.status(403).json({ error: "You can only view submissions for your own assignments" });
    return;
  }
  const subs = await db.select().from(assignmentSubmissionsTable).where(eq(assignmentSubmissionsTable.assignmentId, assignmentId));
  res.json(subs);
});

router.post("/:id/submit", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (user.role !== "student") { res.status(403).json({ error: "Forbidden" }); return; }
  const assignmentId = parseInt(String(req.params.id));
  const { content, fileUrl, fileName } = req.body;
  const normalizedFileUrl = normalizeAttachmentUrl(fileUrl);
  if (fileUrl != null && normalizedFileUrl == null) { res.status(400).json({ error: "fileUrl must be a valid http(s) URL" }); return; }
  if ((typeof content !== "string" || content.length > 100000) || (!content.trim() && !normalizedFileUrl)) { res.status(400).json({ error: "content or a fileUrl is required; content must be at most 100000 characters" }); return; }
  const [assignment] = await db.select({ status: assignmentsTable.status, grade: assignmentsTable.grade, dueDate: assignmentsTable.dueDate }).from(assignmentsTable).where(eq(assignmentsTable.id, assignmentId));
  if (!assignment || !isVisibleToStudent(assignment, user.grade)) { res.status(404).json({ error: "Not found" }); return; }
  if (new Date(`${assignment.dueDate}T23:59:59Z`) < new Date()) { res.status(409).json({ error: "This assignment is past its due date" }); return; }
  const [existing] = await db.select().from(assignmentSubmissionsTable)
    .where(and(eq(assignmentSubmissionsTable.assignmentId, assignmentId), eq(assignmentSubmissionsTable.studentId, user.id)));
  if (existing) {
    const [updated] = await db.update(assignmentSubmissionsTable).set({ content: content.trim(), fileUrl: normalizedFileUrl, fileName, status: "submitted" })
      .where(eq(assignmentSubmissionsTable.id, existing.id)).returning();
    res.json(updated); return;
  }
  const [row] = await db.insert(assignmentSubmissionsTable).values({
    assignmentId, studentId: user.id, studentName: user.name, content: content.trim(), fileUrl: normalizedFileUrl, fileName,
  }).returning();
  res.status(201).json(row);
});

router.put("/submissions/:subId/grade", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (user.role !== "teacher" && user.role !== "owner") { res.status(403).json({ error: "Forbidden" }); return; }
  const { marks, feedback } = req.body;
  const submissionId = parseInt(String(req.params.subId));
  const [submission] = await db.select({ teacherId: assignmentsTable.teacherId, totalMarks: assignmentsTable.totalMarks }).from(assignmentSubmissionsTable)
    .innerJoin(assignmentsTable, eq(assignmentSubmissionsTable.assignmentId, assignmentsTable.id))
    .where(eq(assignmentSubmissionsTable.id, submissionId));
  if (!submission) { res.status(404).json({ error: "Not found" }); return; }
  if (user.role !== "owner" && submission.teacherId !== user.id) { res.status(403).json({ error: "You can only grade your own assignments" }); return; }
  const numericMarks = typeof marks === "number" ? marks : Number(marks);
  if (!Number.isFinite(numericMarks) || numericMarks < 0 || numericMarks > submission.totalMarks || (feedback != null && (typeof feedback !== "string" || feedback.length > 5000))) {
    res.status(400).json({ error: `marks must be between 0 and ${submission.totalMarks}; feedback must be at most 5000 characters` }); return;
  }
  const [row] = await db.update(assignmentSubmissionsTable)
    .set({ marks: numericMarks.toString(), feedback, status: "graded", gradedBy: user.id, gradedAt: new Date() })
    .where(eq(assignmentSubmissionsTable.id, submissionId)).returning();
  res.json(row);
});

export default router;
