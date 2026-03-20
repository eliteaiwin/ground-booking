import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { MessageCircle, Send, Image, Video, Upload, Smile, Reply, Trash2, X, ChevronDown, ChevronUp } from 'lucide-react';

const EMOJI_OPTIONS = ['👍', '❤️', '😂', '🔥', '⚽', '🏆', '👏', '💪', '🎉', '😮'];

interface Reaction {
  emoji: string;
  count: number;
  users: { user_id: number; name: string }[];
}

interface DiscussionMessage {
  id: number;
  game_id: number | null;
  user_id: number;
  user_name: string;
  message: string;
  created_at: string;
  reactions: Reaction[];
  replies: DiscussionMessage[];
}

interface MediaItem {
  id: number;
  game_id: number;
  user_id: number;
  user_name: string;
  media_type: string;
  file_path: string;
  file_name: string;
  caption: string;
  created_at: string;
  comment_count: number;
  reactions: Reaction[];
}

interface MediaComment {
  id: number;
  media_id: number;
  user_id: number;
  user_name: string;
  comment: string;
  created_at: string;
  reactions: Reaction[];
  replies: MediaComment[];
}

interface Props {
  gameId?: number;
  gameStatus?: string;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

function EmojiPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  return (
    <div className="absolute bottom-full left-0 mb-1 bg-white border rounded-lg shadow-lg p-2 flex gap-1 z-20">
      {EMOJI_OPTIONS.map(emoji => (
        <button key={emoji} onClick={() => { onSelect(emoji); onClose(); }} className="text-lg hover:bg-gray-100 rounded p-1 transition-transform hover:scale-125">
          {emoji}
        </button>
      ))}
    </div>
  );
}

function ReactionBar({ reactions, targetType, targetId, userId, onReact }: {
  reactions: Reaction[];
  targetType: string;
  targetId: number;
  userId: number;
  onReact: (targetType: string, targetId: number, emoji: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="flex items-center gap-1 flex-wrap relative">
      {reactions.map(r => {
        const isMine = r.users.some(u => u.user_id === userId);
        return (
          <button
            key={r.emoji}
            onClick={() => onReact(targetType, targetId, r.emoji)}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${isMine ? 'bg-blue-100 border-blue-300' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}
            title={r.users.map(u => u.name).join(', ')}
          >
            <span>{r.emoji}</span>
            <span className="text-[10px] text-gray-600">{r.count}</span>
          </button>
        );
      })}
      <div className="relative">
        <button onClick={() => setShowPicker(!showPicker)} className="p-0.5 rounded hover:bg-gray-100 text-gray-400">
          <Smile size={14} />
        </button>
        {showPicker && (
          <EmojiPicker onSelect={(emoji) => onReact(targetType, targetId, emoji)} onClose={() => setShowPicker(false)} />
        )}
      </div>
    </div>
  );
}

export default function Discussion({ gameId, gameStatus }: Props) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'media'>('chat');
  const [showUpload, setShowUpload] = useState(false);
  const [uploadCaption, setUploadCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [mediaComments, setMediaComments] = useState<MediaComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentReplyTo, setCommentReplyTo] = useState<{ id: number; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const canUploadMedia = Boolean(gameId) && gameStatus === 'completed';

  useEffect(() => {
    loadData();
    // Poll for new messages every 10 seconds
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [gameId]);

  const loadData = async () => {
    try {
      const msgs = await api.getDiscussionMessages(gameId);
      setMessages(msgs);
      if (gameId) {
        const mediaData = await api.getDiscussionMedia(gameId);
        setMedia(mediaData);
      }
    } catch (err) {
      console.error('Failed to load discussion:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!newMessage.trim()) return;
    setSending(true);
    try {
      await api.postDiscussionMessage(newMessage.trim(), gameId, replyTo?.id);
      setNewMessage('');
      setReplyTo(null);
      await loadData();
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleReact = async (targetType: string, targetId: number, emoji: string) => {
    try {
      await api.toggleReaction(targetType, targetId, emoji);
      await loadData();
      if (selectedMedia) {
        const comments = await api.getMediaComments(selectedMedia.id);
        setMediaComments(comments);
      }
    } catch (err) {
      console.error('Failed to react:', err);
    }
  };

  const handleDelete = async (messageId: number) => {
    try {
      await api.deleteDiscussionMessage(messageId);
      await loadData();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !gameId) return;

    const mediaType = file.type.startsWith('video/') ? 'video' : 'photo';
    setUploading(true);
    try {
      await api.uploadMedia(gameId, file, mediaType, uploadCaption);
      setShowUpload(false);
      setUploadCaption('');
      await loadData();
    } catch (err) {
      console.error('Failed to upload:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openMediaDetail = async (item: MediaItem) => {
    setSelectedMedia(item);
    try {
      const comments = await api.getMediaComments(item.id);
      setMediaComments(comments);
    } catch (err) {
      console.error('Failed to load comments:', err);
    }
  };

  const handlePostComment = async () => {
    if (!newComment.trim() || !selectedMedia) return;
    try {
      await api.postMediaComment(selectedMedia.id, newComment.trim(), commentReplyTo?.id);
      setNewComment('');
      setCommentReplyTo(null);
      const comments = await api.getMediaComments(selectedMedia.id);
      setMediaComments(comments);
      // Also refresh media to update comment count
      if (gameId) {
        const mediaData = await api.getDiscussionMedia(gameId);
        setMedia(mediaData);
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
    }
  };

  if (loading) {
    return <div className="text-center text-gray-400 py-8 text-sm">Loading discussion...</div>;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle size={18} className="text-blue-600" />
          Discussion
          {gameId && (
            <Badge variant="outline" className="text-[10px] ml-1">Game #{gameId}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {/* Tabs: Chat | Media (only for game discussions) */}
        {gameId && (
          <div className="flex gap-1 mb-3">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'chat' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <MessageCircle size={12} className="inline mr-1" /> Chat
            </button>
            <button
              onClick={() => setActiveTab('media')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'media' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <Image size={12} className="inline mr-1" /> Photos & Videos
            </button>
          </div>
        )}

        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <div>
            {/* Messages */}
            <div className="max-h-80 overflow-y-auto space-y-2 mb-3 pr-1">
              {messages.length === 0 ? (
                <p className="text-center text-gray-400 text-xs py-6">No messages yet. Start the conversation!</p>
              ) : (
                [...messages].reverse().map(msg => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    userId={user?.id || 0}
                    onReact={handleReact}
                    onReply={(id, name) => setReplyTo({ id, name })}
                    onDelete={handleDelete}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply indicator */}
            {replyTo && (
              <div className="flex items-center gap-2 mb-1 px-2 py-1 bg-blue-50 rounded text-xs text-blue-700">
                <Reply size={12} />
                <span>Replying to {replyTo.name}</span>
                <button onClick={() => setReplyTo(null)} className="ml-auto text-blue-400 hover:text-blue-600">
                  <X size={12} />
                </button>
              </div>
            )}

            {/* Input */}
            <div className="flex gap-2">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Type a message..."
                className="text-sm h-9"
                disabled={sending}
              />
              <Button size="sm" onClick={handleSend} disabled={!newMessage.trim() || sending} className="h-9 px-3">
                <Send size={14} />
              </Button>
            </div>
          </div>
        )}

        {/* Media Tab */}
        {activeTab === 'media' && gameId && (
          <div>
            {/* Upload button */}
            {canUploadMedia ? (
              <div className="mb-3">
                <Button size="sm" variant="outline" onClick={() => setShowUpload(!showUpload)} className="text-xs w-full">
                  <Upload size={12} className="mr-1" /> Upload Photo / Video
                </Button>

                {showUpload && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg space-y-2">
                    <Input
                      value={uploadCaption}
                      onChange={(e) => setUploadCaption(e.target.value)}
                      placeholder="Add a caption (optional)"
                      className="text-sm h-8"
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*"
                      onChange={handleUpload}
                      className="text-xs w-full"
                      disabled={uploading}
                    />
                    {uploading && <p className="text-xs text-blue-600">Uploading...</p>}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-400 mb-3">Media upload is available after the game is completed.</p>
            )}

            {/* Media grid */}
            {media.length === 0 ? (
              <p className="text-center text-gray-400 text-xs py-6">No photos or videos yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {media.map(item => (
                  <div
                    key={item.id}
                    onClick={() => openMediaDetail(item)}
                    className="cursor-pointer rounded-lg overflow-hidden border hover:shadow-md transition-shadow bg-white"
                  >
                    {item.media_type === 'photo' ? (
                      <img
                        src={`${import.meta.env.VITE_API_URL || ''}${item.file_path}`}
                        alt={item.caption || 'Photo'}
                        className="w-full h-28 object-cover"
                      />
                    ) : (
                      <div className="w-full h-28 bg-gray-900 flex items-center justify-center">
                        <Video size={24} className="text-white" />
                      </div>
                    )}
                    <div className="p-1.5">
                      {item.caption && <p className="text-[10px] text-gray-600 truncate">{item.caption}</p>}
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[10px] text-gray-400">{item.user_name}</span>
                        <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                          <MessageCircle size={8} /> {item.comment_count}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Media Detail Modal */}
        {selectedMedia && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center">
            <div className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl">
              {/* Header */}
              <div className="sticky top-0 bg-white border-b p-3 flex items-center justify-between z-10">
                <div>
                  <p className="text-sm font-semibold">{selectedMedia.user_name}</p>
                  <p className="text-[10px] text-gray-400">{timeAgo(selectedMedia.created_at)}</p>
                </div>
                <button onClick={() => { setSelectedMedia(null); setMediaComments([]); }} className="p-1 hover:bg-gray-100 rounded">
                  <X size={18} />
                </button>
              </div>

              {/* Media */}
              <div className="bg-gray-900">
                {selectedMedia.media_type === 'photo' ? (
                  <img
                    src={`${import.meta.env.VITE_API_URL || ''}${selectedMedia.file_path}`}
                    alt={selectedMedia.caption || 'Photo'}
                    className="w-full max-h-72 object-contain"
                  />
                ) : (
                  <video
                    src={`${import.meta.env.VITE_API_URL || ''}${selectedMedia.file_path}`}
                    controls
                    className="w-full max-h-72"
                  />
                )}
              </div>

              {/* Caption & reactions */}
              <div className="p-3 space-y-2">
                {selectedMedia.caption && (
                  <p className="text-sm text-gray-700">{selectedMedia.caption}</p>
                )}
                <ReactionBar
                  reactions={selectedMedia.reactions}
                  targetType="media"
                  targetId={selectedMedia.id}
                  userId={user?.id || 0}
                  onReact={handleReact}
                />
              </div>

              <Separator />

              {/* Comments */}
              <div className="p-3 space-y-3 max-h-48 overflow-y-auto">
                {mediaComments.length === 0 ? (
                  <p className="text-center text-gray-400 text-xs py-2">No comments yet</p>
                ) : (
                  mediaComments.map(c => (
                    <CommentItem
                      key={c.id}
                      comment={c}
                      userId={user?.id || 0}
                      onReact={handleReact}
                      onReply={(id, name) => setCommentReplyTo({ id, name })}
                    />
                  ))
                )}
              </div>

              {/* Comment input */}
              <div className="sticky bottom-0 bg-white border-t p-2">
                {commentReplyTo && (
                  <div className="flex items-center gap-2 mb-1 px-2 py-1 bg-blue-50 rounded text-xs text-blue-700">
                    <Reply size={10} />
                    <span>Replying to {commentReplyTo.name}</span>
                    <button onClick={() => setCommentReplyTo(null)} className="ml-auto">
                      <X size={10} />
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handlePostComment(); } }}
                    placeholder="Add a comment..."
                    className="text-sm h-8"
                  />
                  <Button size="sm" onClick={handlePostComment} disabled={!newComment.trim()} className="h-8 px-2">
                    <Send size={12} />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MessageBubble({ msg, userId, onReact, onReply, onDelete }: {
  msg: DiscussionMessage;
  userId: number;
  onReact: (tt: string, ti: number, e: string) => void;
  onReply: (id: number, name: string) => void;
  onDelete: (id: number) => void;
}) {
  const isMine = msg.user_id === userId;
  const [showReplies, setShowReplies] = useState(false);

  return (
    <div className={`${isMine ? 'ml-6' : 'mr-6'}`}>
      <div className={`rounded-xl px-3 py-2 ${isMine ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50 border border-gray-100'}`}>
        <div className="flex items-center justify-between mb-0.5">
          <span className={`text-[11px] font-semibold ${isMine ? 'text-blue-700' : 'text-gray-700'}`}>
            {msg.user_name}
          </span>
          <span className="text-[10px] text-gray-400">{timeAgo(msg.created_at)}</span>
        </div>
        <p className="text-sm text-gray-800 whitespace-pre-wrap">{msg.message}</p>

        <div className="flex items-center gap-2 mt-1.5">
          <ReactionBar reactions={msg.reactions} targetType="message" targetId={msg.id} userId={userId} onReact={onReact} />
          <button onClick={() => onReply(msg.id, msg.user_name)} className="text-gray-400 hover:text-blue-600 p-0.5">
            <Reply size={12} />
          </button>
          {isMine && (
            <button onClick={() => onDelete(msg.id)} className="text-gray-300 hover:text-red-500 p-0.5">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Replies */}
      {msg.replies.length > 0 && (
        <div className="ml-4 mt-1">
          <button
            onClick={() => setShowReplies(!showReplies)}
            className="text-[10px] text-blue-600 flex items-center gap-1 mb-1"
          >
            {showReplies ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {msg.replies.length} {msg.replies.length === 1 ? 'reply' : 'replies'}
          </button>
          {showReplies && msg.replies.map(r => (
            <div key={r.id} className="mb-1 rounded-lg px-2.5 py-1.5 bg-white border border-gray-100">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-semibold text-gray-600">{r.user_name}</span>
                <span className="text-[9px] text-gray-400">{timeAgo(r.created_at)}</span>
              </div>
              <p className="text-xs text-gray-700">{r.message}</p>
              <ReactionBar reactions={r.reactions} targetType="message" targetId={r.id} userId={userId} onReact={onReact} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentItem({ comment, userId, onReact, onReply }: {
  comment: MediaComment;
  userId: number;
  onReact: (tt: string, ti: number, e: string) => void;
  onReply: (id: number, name: string) => void;
}) {
  const [showReplies, setShowReplies] = useState(false);

  return (
    <div>
      <div className="flex gap-2">
        <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600 flex-shrink-0">
          {comment.user_name.charAt(0)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-700">{comment.user_name}</span>
            <span className="text-[10px] text-gray-400">{timeAgo(comment.created_at)}</span>
          </div>
          <p className="text-xs text-gray-600 mt-0.5">{comment.comment}</p>
          <div className="flex items-center gap-2 mt-1">
            <ReactionBar reactions={comment.reactions} targetType="media_comment" targetId={comment.id} userId={userId} onReact={onReact} />
            <button onClick={() => onReply(comment.id, comment.user_name)} className="text-[10px] text-gray-400 hover:text-blue-600">
              Reply
            </button>
          </div>
        </div>
      </div>

      {/* Replies */}
      {comment.replies.length > 0 && (
        <div className="ml-8 mt-1 space-y-1.5">
          <button onClick={() => setShowReplies(!showReplies)} className="text-[10px] text-blue-600 flex items-center gap-1">
            {showReplies ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
          </button>
          {showReplies && comment.replies.map(r => (
            <div key={r.id} className="flex gap-2">
              <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-500 flex-shrink-0">
                {r.user_name.charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-gray-600">{r.user_name}</span>
                  <span className="text-[9px] text-gray-400">{timeAgo(r.created_at)}</span>
                </div>
                <p className="text-[11px] text-gray-600">{r.comment}</p>
                <ReactionBar reactions={r.reactions} targetType="media_comment" targetId={r.id} userId={userId} onReact={onReact} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
