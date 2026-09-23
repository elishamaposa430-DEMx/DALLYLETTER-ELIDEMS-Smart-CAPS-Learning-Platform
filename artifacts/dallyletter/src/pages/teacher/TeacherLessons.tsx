import { DashboardLayout } from "@/components/DashboardLayout";
import { resolveBaseUrl, useListLessons, useCreateLesson, useDeleteLesson } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useRef, useState } from "react";
import { Loader2, Plus, Trash2, Video, Image as ImageIcon, Headphones, FileText, BookOpen, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListLessonsQueryKey } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CreateLessonBodyType } from "@workspace/api-client-react";

const createLessonSchema = z.object({
  title: z.string().min(2, "Title is required"),
  description: z.string().optional(),
  subject: z.string().min(2, "Subject is required"),
  grade: z.string().optional(),
  type: z.enum([CreateLessonBodyType.video, CreateLessonBodyType.image, CreateLessonBodyType.audio, CreateLessonBodyType.notes, CreateLessonBodyType.mixed]),
  mediaUrl: z.string().optional(),
  content: z.string().optional(),
});

export default function TeacherLessons() {
  const { data: lessons, isLoading } = useListLessons();
  const createLessonMutation = useCreateLesson();
  const deleteLessonMutation = useDeleteLesson();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; previewUrl: string; mimeType: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof createLessonSchema>>({
    resolver: zodResolver(createLessonSchema),
    defaultValues: {
      title: "",
      description: "",
      subject: "",
      grade: "",
      type: CreateLessonBodyType.notes,
      mediaUrl: "",
      content: "",
    },
  });
  const selectedLessonType = form.watch("type");

  const onSubmit = (values: z.infer<typeof createLessonSchema>) => {
    createLessonMutation.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Lesson created", description: "Your lesson has been published." });
        queryClient.invalidateQueries({ queryKey: getListLessonsQueryKey() });
        setIsDialogOpen(false);
        form.reset();
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Error", description: error.message || "Failed to create lesson" });
      }
    });
  };

  const handleMediaUpload = (file: File) => {
    const isDocument = selectedLessonType === "notes" && ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.type);
    const expectedPrefix = selectedLessonType === "audio" ? "audio/" : selectedLessonType === "image" ? "image/" : "video/";
    if (!file.type.startsWith(expectedPrefix) && !isDocument) {
      toast({ variant: "destructive", title: "Unsupported media", description: `Choose a supported ${selectedLessonType} file.` });
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setUploadedFile({ name: file.name, previewUrl, mimeType: file.type });
    setUploadProgress(0);
    const request = new XMLHttpRequest();
    request.open("POST", resolveBaseUrl("/api/lessons/media"));
    const token = localStorage.getItem("dallyletter_token");
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        setUploadProgress(null);
        toast({ variant: "destructive", title: "Upload failed", description: "The video could not be uploaded." });
        return;
      }
      const result = JSON.parse(request.responseText) as { mediaUrl: string };
      form.setValue("mediaUrl", result.mediaUrl, { shouldValidate: true });
      setUploadProgress(100);
      toast({ title: "Video uploaded", description: "Preview it below, then publish the lesson." });
    };
    request.onerror = () => {
      setUploadProgress(null);
      toast({ variant: "destructive", title: "Upload failed", description: "Check your connection and try again." });
    };
    const formData = new FormData();
    formData.append("file", file);
    request.send(formData);
  };

  const removeUploadedVideo = () => {
    if (uploadedFile) URL.revokeObjectURL(uploadedFile.previewUrl);
    setUploadedFile(null);
    setUploadProgress(null);
    form.setValue("mediaUrl", "");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this lesson?")) {
      deleteLessonMutation.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "Lesson deleted" });
          queryClient.invalidateQueries({ queryKey: getListLessonsQueryKey() });
        }
      });
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "video": return <Video className="h-4 w-4" />;
      case "image": return <ImageIcon className="h-4 w-4" />;
      case "audio": return <Headphones className="h-4 w-4" />;
      case "notes": return <FileText className="h-4 w-4" />;
      default: return <BookOpen className="h-4 w-4" />;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Lessons</h1>
            <p className="text-muted-foreground">Manage and publish your course materials.</p>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Add Lesson
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Lesson</DialogTitle>
                <DialogDescription>
                  Upload materials or write notes for your students.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Introduction to Algebra" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="subject"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Subject</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Mathematics" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="grade"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Grade</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select Grade" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {["Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"].map(g => (
                                <SelectItem key={g} value={g}>{g}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lesson Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select Type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={CreateLessonBodyType.video}>Video</SelectItem>
                            <SelectItem value={CreateLessonBodyType.image}>Image</SelectItem>
                            <SelectItem value={CreateLessonBodyType.audio}>Audio</SelectItem>
                            <SelectItem value={CreateLessonBodyType.notes}>Notes</SelectItem>
                            <SelectItem value={CreateLessonBodyType.mixed}>Mixed</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Brief overview of the lesson..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="mediaUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lesson Link URL (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="https://... (learners click the title to open this)" {...field} />
                        </FormControl>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept={selectedLessonType === "audio" ? "audio/*" : selectedLessonType === "image" ? "image/*" : selectedLessonType === "notes" ? ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "video/*"}
                            className="sr-only"
                            onChange={(event) => event.target.files?.[0] && handleMediaUpload(event.target.files[0])}
                          />
                          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()} disabled={uploadProgress !== null && uploadProgress < 100}>
                            <Upload className="h-4 w-4" />
                            Upload {selectedLessonType === "audio" ? "Audio" : selectedLessonType === "image" ? "Image" : "Video"}
                          </Button>
                          {uploadedFile && (
                            <Button type="button" variant="ghost" size="sm" className="gap-1 text-destructive" onClick={removeUploadedVideo}>
                              <X className="h-4 w-4" />
                              Remove
                            </Button>
                          )}
                        </div>
                        {uploadProgress !== null && (
                          <div className="space-y-1" aria-live="polite">
                            <div className="flex justify-between text-xs text-muted-foreground"><span>Upload progress</span><span>{uploadProgress}%</span></div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${uploadProgress}%` }} /></div>
                          </div>
                        )}
                        {uploadedFile && selectedLessonType === "video" && <video className="mt-2 max-h-48 w-full rounded-md bg-black" src={uploadedFile.previewUrl} controls />}
                        {uploadedFile && selectedLessonType === "audio" && <audio className="mt-2 w-full" src={uploadedFile.previewUrl} controls />}
                        {uploadedFile && selectedLessonType === "image" && <img className="mt-2 max-h-48 w-full rounded-md object-contain" src={uploadedFile.previewUrl} alt="Lesson preview" />}
                        {uploadedFile && selectedLessonType === "notes" && uploadedFile.mimeType === "application/pdf" && <iframe className="mt-2 h-48 w-full rounded-md border" src={uploadedFile.previewUrl} title="Document preview" />}
                        <p className="text-xs text-muted-foreground">Paste a URL for an external lesson, or upload media to keep playback inside Elidems.</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="content"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Content / Notes (Optional)</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Full lesson content..." className="min-h-[150px]" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={createLessonMutation.isPending || uploadProgress !== null && uploadProgress < 100}>
                      {createLessonMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Publish Lesson
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {lessons?.length === 0 ? (
              <div className="col-span-full text-center p-8 border rounded-lg bg-card">
                <p className="text-muted-foreground">You haven't created any lessons yet.</p>
              </div>
            ) : (
              lessons?.map((lesson) => (
                <Card key={lesson.id} className="flex flex-col h-full hover:border-primary/50 transition-colors group">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                          {lesson.subject}
                        </Badge>
                        {lesson.grade && (
                          <Badge variant="secondary" className="text-xs">
                            {lesson.grade}
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted-foreground bg-muted p-1.5 rounded-md">
                        {getTypeIcon(lesson.type)}
                      </div>
                    </div>
                    <CardTitle className="text-lg mt-2 line-clamp-2">{lesson.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="mt-auto flex-1">
                    <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                      {lesson.description || "No description provided."}
                    </p>
                    <div className="text-xs text-muted-foreground">
                      Added on {new Date(lesson.createdAt).toLocaleDateString()}
                    </div>
                  </CardContent>
                  <CardFooter className="pt-4 border-t flex justify-end">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive gap-2"
                      onClick={() => handleDelete(lesson.id)}
                      disabled={deleteLessonMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  </CardFooter>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
