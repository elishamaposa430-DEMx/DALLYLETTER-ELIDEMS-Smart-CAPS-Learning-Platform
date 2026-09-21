import { DashboardLayout } from "@/components/DashboardLayout";
import { AuthenticatedMedia } from "@/components/AuthenticatedMedia";
import { useListLessons } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Loader2, Search, FileText, Image as ImageIcon, Video, Headphones, BookOpen, ExternalLink, GraduationCap } from "lucide-react";

export default function StudentLessons() {
  const { data: lessons, isLoading } = useListLessons();
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");

  const filteredLessons = lessons?.filter((lesson) => {
    const matchesSearch =
      lesson.title.toLowerCase().includes(search.toLowerCase()) ||
      lesson.description?.toLowerCase().includes(search.toLowerCase());
    const matchesSubject = subjectFilter === "all" || lesson.subject === subjectFilter;
    return matchesSearch && matchesSubject;
  });

  const subjects = Array.from(new Set(lessons?.map((l) => l.subject) || []));

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "video":
        return <Video className="h-4 w-4" />;
      case "image":
        return <ImageIcon className="h-4 w-4" />;
      case "audio":
        return <Headphones className="h-4 w-4" />;
      case "notes":
        return <FileText className="h-4 w-4" />;
      default:
        return <BookOpen className="h-4 w-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "video": return "bg-blue-500/10 text-blue-600 border-blue-200";
      case "image": return "bg-purple-500/10 text-purple-600 border-purple-200";
      case "audio": return "bg-orange-500/10 text-orange-600 border-orange-200";
      case "notes": return "bg-green-500/10 text-green-600 border-green-200";
      default: return "bg-primary/10 text-primary border-primary/20";
    }
  };

  const handleOpen = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Lessons</h1>
            <p className="text-muted-foreground">Browse your course materials and study notes.</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full border">
            <GraduationCap className="h-4 w-4" />
            <span>{lessons?.length || 0} lessons available</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search lessons by title or description..."
              className="pl-9 h-11"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-full sm:w-[200px] h-11">
              <SelectValue placeholder="All Subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              {subjects.map((sub) => (
                <SelectItem key={sub} value={sub}>{sub}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-16">
            <div className="text-center space-y-3">
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
              <p className="text-sm text-muted-foreground">Loading lessons...</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredLessons?.length === 0 ? (
              <div className="col-span-full text-center py-16 border-2 border-dashed rounded-xl bg-muted/20">
                <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
                <p className="text-lg font-medium text-muted-foreground">No lessons found</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Try a different search or subject filter</p>
              </div>
            ) : (
              filteredLessons?.map((lesson) => (
                <Card
                  key={lesson.id}
                  className="flex flex-col h-full transition-all duration-200 border hover:shadow-lg hover:-translate-y-0.5"
                >
                  <CardHeader className="pb-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 font-medium">
                        {lesson.subject}
                      </Badge>
                      <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${getTypeColor(lesson.type)}`}>
                        {getTypeIcon(lesson.type)}
                        {lesson.type}
                      </span>
                    </div>

                    <div>
                      <h3 className="font-bold text-lg leading-tight text-foreground line-clamp-2">
                        {lesson.title}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">by {lesson.teacherName}</p>
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 flex flex-col justify-between gap-4">
                    {lesson.mediaUrl && (
                      <AuthenticatedMedia src={lesson.mediaUrl} type={lesson.type} title={lesson.title} />
                    )}

                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {lesson.description || "No description provided."}
                    </p>

                    <div className="flex items-center justify-between pt-3 border-t">
                      <span className="text-xs text-muted-foreground">
                        {new Date(lesson.createdAt).toLocaleDateString("en-ZA", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      {lesson.mediaUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-8 text-xs"
                          onClick={() => handleOpen(lesson.mediaUrl!)}
                        >
                          Open in new tab
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
