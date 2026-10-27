import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tauriApi } from '@/lib/tauri';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AchievementGuide, Comment } from '@/lib/tauri';
import { formatRelativeDate } from '@/lib/utils';
import { ChevronLeft, Star, PlaySquare, MessageSquare, Sparkles, ThumbsUp, ThumbsDown, Share2 } from 'lucide-react';

type TabValue = 'ai' | 'community' | 'media';

export function AchievementPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabValue>('community');
  const [newComment, setNewComment] = useState('');
  const queryClient = useQueryClient();

  const { data: guide, isLoading } = useQuery<{ guides: AchievementGuide[] }>({
    queryKey: ['achievement-detail', id],
    queryFn: async () => {
      // Achievement detail would come from a dedicated command;
      // for now we fetch guides and construct a basic payload.
      const guides = await tauriApi.getAchievementGuides(id);
      return { guides };
    },
    enabled: !!id,
  });

  const { data: comments, refetch: refetchComments } = useQuery({
    queryKey: ['comments', id],
    queryFn: () => tauriApi.getComments(id),
    enabled: !!id,
  });

  const createCommentMutation = useMutation({
    mutationFn: (content: string) =>
      tauriApi.createComment({ achievement_id: id, content_md: content, parent_id: null }),
    onSuccess: () => {
      setNewComment('');
      refetchComments();
      queryClient.invalidateQueries({ queryKey: ['comments', id] });
    },
    onError: () => {
      toast.error("Échec de l'envoi du commentaire");
    },
  });

  const createGuideMutation = useMutation({
    mutationFn: (request: { achievement_id: string; content_md: string; content_type: string; video_url: string | null; images: string[] }) =>
      tauriApi.createGuide(request),
    onSuccess: () => {
      toast.success('Guide créé');
      queryClient.invalidateQueries({ queryKey: ['achievement-detail', id] });
    },
    onError: () => {
      toast.error('Échec de la création du guide');
    },
  });

  const generateAiGuideMutation = useMutation({
    mutationFn: (request: { achievement_id: string; game_name: string; achievement_name: string; achievement_description: string; trophy_type: string | null; known_requirements: string | null }) =>
      tauriApi.generateAiGuide(request),
    onSuccess: () => {
      toast.success('Guide IA généré');
      queryClient.invalidateQueries({ queryKey: ['achievement-detail', id] });
    },
    onError: () => {
      toast.error('Échec de la génération du guide IA');
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="skeleton-text h-96 w-full animate-pulse" />
      </div>
    );
  }

  const guides = guide?.guides ?? [];

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/games">
            <ChevronLeft className="w-4 h-4 mr-2" />
            Retour aux jeux
          </Link>
        </Button>
      </div>

      {/* Achievement Header */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-center gap-6">
            <div className="flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-border">
              <div className="w-full h-full bg-secondary flex items-center justify-center text-4xl">
                🏆
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-xs">Bronze</Badge>
                <span className="text-sm text-muted-foreground">Non déverrouillé</span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight mb-1">Nom de l'object</h1>
              <p className="text-muted-foreground">Description de l'object apparaît ici.</p>
              <div className="flex items-center gap-2 mt-4">
                <span className="text-sm font-mono text-muted-foreground">15.2% des joueurs</span>
                <span className="text-sm font-mono text-muted-foreground">10 points</span>
              </div>
            </div>
            <div>
              <Button
                variant="outline"
                disabled={generateAiGuideMutation.isPending}
                onClick={() =>
                  generateAiGuideMutation.mutate({
                    achievement_id: id,
                    game_name: '',
                    achievement_name: '',
                    achievement_description: '',
                    trophy_type: null,
                    known_requirements: null,
                  })
                }
              >
                <Sparkles className={`w-4 h-4 mr-2 ${generateAiGuideMutation.isPending ? 'animate-pulse' : ''}`} />
                Générer guide IA
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Guides Tabs */}
      <Tabs defaultValue="community" value={activeTab} onValueChange={(val) => setActiveTab(val as TabValue)}>
        <TabsList className="guide-tabs">
          <TabsTrigger value="ai" className="guide-tab">
            <Sparkles className="w-3 h-3 mr-1" /> Guide IA
          </TabsTrigger>
          <TabsTrigger value="community" className="guide-tab">
            <Star className="w-3 h-3 mr-1" /> Guides communauté
          </TabsTrigger>
          <TabsTrigger value="media" className="guide-tab">
            <PlaySquare className="w-3 h-3 mr-1" /> Vidéos & Images
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai" className="space-y-4">
          <div className="p-4 bg-secondary/50 rounded-lg border border-border">
            <p className="text-sm text-muted-foreground">
              Aucun guide IA généré pour cet object. Cliquez sur « Générer guide IA » pour en créer un.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="community" className="space-y-4">
          {guides.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Aucun guide communautaire pour cet object.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {guides.map((g) => <GuideCard key={g.id} guide={g} />)}
            </div>
          )}
          <div className="pt-4 border-t border-border">
            <Button
              disabled={createGuideMutation.isPending}
              onClick={() =>
                createGuideMutation.mutate({
                  achievement_id: id,
                  content_md: '',
                  content_type: 'community',
                  video_url: null,
                  images: [],
                })
              }
            >
              <Star className="w-4 h-4 mr-2" />
              Écrire un guide
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="media" className="space-y-4">
          <div className="text-center py-12 text-muted-foreground">
            Aucune vidéo ou image pour cet object.
          </div>
        </TabsContent>
      </Tabs>

      {/* Comments Section */}
      <div className="border-t border-border pt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            <MessageSquare className="w-5 h-5 mr-2 inline-block" /> Commentaires ({comments?.length ?? 0})
          </h2>
        </div>

        {/* Comment input */}
        <div className="flex gap-3 mb-6">
          <Input
            placeholder="Écrire un commentaire…"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && newComment.trim()) {
                createCommentMutation.mutate(newComment);
              }
            }}
            className="min-h-[100px]"
          />
          <Button
            disabled={!newComment.trim() || createCommentMutation.isPending}
            onClick={() => createCommentMutation.mutate(newComment)}
            className="whitespace-nowrap"
          >
            Publier
          </Button>
        </div>

        {/* Comments list */}
        <div className="space-y-4">
          {comments?.length === 0 && (
            <p className="text-muted-foreground text-center py-8">Soyez le premier à commenter !</p>
          )}
          {comments?.map((comment) => <CommentThread key={comment.id} comment={comment} />)}
        </div>
      </div>
    </div>
  );
}

function GuideCard({ guide }: { guide: AchievementGuide }) {
  return (
    <Card className="p-4 hover:border-primary/50 transition-colors cursor-pointer group">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs shrink-0">
          👤
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium">{guide.author_username}</span>
            {guide.ai_generated && (
              <Badge variant="outline" className="text-[10px]">IA</Badge>
            )}
            {guide.verified && (
              <Badge variant="secondary" className="text-[10px]">✓ Vérifié</Badge>
            )}
          </div>
          <div className="prose prose-sm text-muted-foreground max-w-none mb-3">
            {guide.content_md.slice(0, 200)}...
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{guide.upvotes} 👍 • {guide.downvotes} 👎</span>
            <span>{formatRelativeDate(guide.created_at)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function CommentThread({ comment }: { comment: Comment }) {
  return (
    <div className="comment-thread flex gap-3">
      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs shrink-0">
        {comment.avatar_url ? (
          <img src={comment.avatar_url} alt={comment.username} className="rounded-full" />
        ) : (
          '👤'
        )}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">{comment.username}</span>
          <span className="text-xs text-muted-foreground">{formatRelativeDate(comment.created_at)}</span>
        </div>
        <div className="prose prose-sm max-w-none mb-2">{comment.content_md}</div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <button className="flex items-center gap-1 hover:text-primary transition-colors">
            <ThumbsUp className="w-3 h-3" /> {comment.reactions.helpful}
          </button>
          <button className="flex items-center gap-1 hover:text-primary transition-colors">
            <ThumbsDown className="w-3 h-3" /> {comment.reactions.funny}
          </button>
          <button className="flex items-center gap-1 hover:text-primary transition-colors">
            <MessageSquare className="w-3 h-3" /> Répondre
          </button>
          <Share2 className="w-3 h-3 ml-auto cursor-pointer hover:text-primary" />
        </div>
        {comment.replies && comment.replies.length > 0 && (
          <div className="ml-4 mt-2 space-y-2">
            {comment.replies.map((reply) => <CommentThread key={reply.id} comment={reply} />)}
          </div>
        )}
      </div>
    </div>
  );
}

