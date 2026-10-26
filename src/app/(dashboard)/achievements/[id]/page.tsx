'use client';

import { useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tauriApi } from '@/lib/tauri';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AchievementGuide, Comment } from '@/lib/tauri';
import { getTrophyColor, getTrophyIcon, formatRelativeDate } from '@/lib/utils';
import { ChevronLeft, Trophy2, Star, PlaySquare, MessageSquare, Sparkles, ThumbsUp, ThumbsDown, Share2 } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface AchievementPageProps {
  params: Promise<{ id: string }>;
}

export default function AchievementPage({ params }: AchievementPageProps) {
  const { id } = await params;
  const [activeTab, setActiveTab] = useState<'ai' | 'community' | 'media'>('community');
  const [newComment, setNewComment] = useState('');
  const queryClient = useQueryClient();

  const { data: guide, isLoading } = useQuery({
    queryKey: ['achievement-detail', id],
    queryFn: async () => {
      // We need to get the achievement details - this would come from a different API
      // For now, we'll get guides and construct a basic detail
      const guides = await tauriApi.getAchievementGuides(id);
      return { guides };
    },
    enabled: !!id,
  });

  const { data: comments, refetch: refetchComments } = useQuery({
    queryKey: ['comments', id],
    queryFn: () => tauriApi.getComments(id),
  });

  const createCommentMutation = useMutation({
    mutationFn: (content: string) => tauriApi.createComment({ achievement_id: id, content_md: content, parent_id: null }),
    onSuccess: () => {
      setNewComment('');
      refetchComments();
      queryClient.invalidateQueries({ queryKey: ['comments', id] });
    },
  });

  const createGuideMutation = useMutation({
    mutationFn: (request: { achievement_id: string; content_md: string; content_type: string; video_url: string | null; images: string[] }) =>
      tauriApi.createGuide(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['achievement-detail', id] });
    },
  });

  const generateAiGuideMutation = useMutation({
    mutationFn: (request: { achievement_id: string; game_name: string; achievement_name: string; achievement_description: string; trophy_type: string | null; known_requirements: string | null }) =>
      tauriApi.generateAiGuide(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['achievement-detail', id] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="skeleton-text h-96 w-full animate-pulse" />
      </div>
    );
  }

  const guides = guide?.guides ?? [];

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild onClick={() => {}}>
          <Link href="/dashboard/games">
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
              <h1 className="text-3xl font-bold tracking-tight mb-1">Nom de l'objet</h1>
              <p className="text-muted-foreground">Description de l'objet apparaît ici.</p>
              <div className="flex items-center gap-2 mt-4">
                <span className="text-sm font-mono text-muted-foreground">15.2% des joueurs</span>
                <span className="text-sm font-mono text-muted-foreground">10 points</span>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => generateAiGuideMutation.mutate({ achievement_id: id, game_name: 'Game Name', achievement_name: 'Achievement Name', achievement_description: 'Description', trophy_type: null, known_requirements: null })}>
                <Sparkles className="w-4 h-4 mr-2" />
                Générer guide IA
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Guides Tabs */}
      <Tabs defaultValue="community" onValueChange={(val) => setActiveTab(val as any)}>
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
              Aucun guide IA généré pour cet objet. Cliquez sur "Générer guide IA" pour en créer un.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="community" className="space-y-4">
          {guides.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Aucun guide communautaire pour cet objet.</p>
              <Button variant="outline" onClick={() => setActiveTab('ai')}>
                Générer un guide avec l'IA
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {guides.map((g) => (
                <GuideCard key={g.id} guide={g} />
              ))}
            </div>
          )}
          <div className="pt-4 border-t border-border">
            <Button onClick={() => createGuideMutation.mutate({ achievement_id: id, content_md: '', content_type: 'community', video_url: null, images: [] })}>
              <Star className="w-4 h-4 mr-2" />
              Écrire un guide
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="media" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Media grid would go here */}
            <div className="text-center py-12 text-muted-foreground">
              Aucune vidéo ou image pour cet objet.
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Comments Section */}
      <div className="border-t border-border pt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            <MessageSquare className="w-5 h-5 mr-2" /> Commentaires ({comments?.length ?? 0})
          </h2>
        </div>

        {/* Comment input */}
        <div className="flex gap-3 mb-6">
          <div className="flex-1">
            <Input
              placeholder="Écrire un commentaire…"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && createCommentMutation.mutate(newComment)}
              className="min-h-[100px]"
            />
          </div>
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
          {comments?.map((comment) => (
            <CommentThread key={comment.id} comment={comment} />
          ))}
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
          {guide.author_avatar ? '👤' : '👤'}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium">{guide.author_username}</span>
            {guide.ai_generated && (
              <Badge variant="outline" size="sm" className="text-[10px]">
                IA
              </Badge>
            )}
            {guide.verified && (
              <Badge variant="secondary" size="sm" className="text-[10px]">
                ✓ Vérifié
              </Badge>
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
    <div className={cn('flex gap-3 pl-4 border-l-2 border-border', comment.depth > 0 && 'ml-4')}>
      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs shrink-0">
        {comment.avatar_avatar || '👤'}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">{comment.username}</span>
          <span className="text-xs text-muted-foreground">{formatRelativeDate(comment.created_at)}</span>
        </div>
        <div className="prose prose-sm text-foreground max-w-none mb-2">
          {comment.content_md}
        </div>
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
        {comment.replies?.length && (
          <div className="ml-4 mt-2 border-l-2 border-border pl-4 space-y-2">
            {comment.replies.map((reply) => (
              <CommentThread key={reply.id} comment={reply} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}