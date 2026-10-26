import { useState } from 'react';
import { formatPhone } from '@/lib/phone';
import { Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export interface ModeratorGroupMember { user_id: number; name: string }
export interface ModeratorGroup { id: number; name: string; parent_id?: number | null; members: ModeratorGroupMember[] }

/** Groups ordered parent-first, each with its nesting depth. */
function groupTree(groups: ModeratorGroup[]): { group: ModeratorGroup; depth: number }[] {
  const ids = new Set(groups.map((g) => g.id));
  const out: { group: ModeratorGroup; depth: number }[] = [];
  const seen = new Set<number>();
  const walk = (parent: number | null, depth: number) => {
    for (const g of groups) {
      const p = g.parent_id != null && ids.has(g.parent_id) ? g.parent_id : null;
      if (p === parent && !seen.has(g.id)) {
        seen.add(g.id);
        out.push({ group: g, depth });
        walk(g.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  groups.filter((g) => !seen.has(g.id)).forEach((g) => out.push({ group: g, depth: 0 }));
  return out;
}

function descendantIds(groups: ModeratorGroup[], id: number): Set<number> {
  const found = new Set<number>();
  let frontier = [id];
  while (frontier.length) {
    frontier = groups.filter((g) => g.parent_id != null && frontier.includes(g.parent_id) && !found.has(g.id)).map((g) => g.id);
    frontier.forEach((x) => found.add(x));
  }
  return found;
}

interface UserHit { id: number; name: string; phone?: string }

export default function ModeratorGroups({ groundId, location, groups, canManage, onChanged }: {
  groundId: number;
  location: string;
  groups: ModeratorGroup[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState('');
  const tree = groupTree(groups);
  const nameOf = (id?: number | null) => groups.find((g) => g.id === id)?.name;
  const [error, setError] = useState('');
  const [searchGroup, setSearchGroup] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };

  const search = async (groupId: number, q: string) => {
    setSearchGroup(groupId);
    setQuery(q);
    if (!q.trim()) { setHits([]); return; }
    const users: UserHit[] = await api.usersByLocation(location, q).catch(() => []);
    const existing = new Set(groups.find((g) => g.id === groupId)?.members.map((m) => m.user_id));
    setHits(users.filter((u) => !existing.has(u.id)).slice(0, 8));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Name a set of moderators (e.g. “Sun Whitefield Mod”) and allot pitches to the whole group. A person can be in several groups.
        Groups can sit under a parent group (e.g. “Lobo Sun Mod” under “Lobo Mod Gang”): a slot allotted to the parent covers everyone in its sub-groups.
        Games played on a group’s allotment are only visible to, and managed by, that group’s moderators.
      </p>
      {error && <p className="text-xs bg-red-50 text-red-700 p-2 rounded">{error}</p>}
      {canManage && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) run(() => api.createModeratorGroup(groundId, newName.trim(), newParent ? Number(newParent) : null)
              .then(() => { setNewName(''); setNewParent(''); }));
          }}
        >
          <div className="flex gap-2">
            <Input placeholder="New group name, e.g. Tue Whitefield Mod" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button type="submit" className="bg-amber-600 hover:bg-amber-700"><Plus size={14} className="mr-1" />Create</Button>
          </div>
          {groups.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              Under
              <select data-testid="new-group-parent" className="border rounded px-2 py-1 bg-white flex-1" value={newParent} onChange={(e) => setNewParent(e.target.value)}>
                <option value="">No parent (top level)</option>
                {tree.map(({ group, depth }) => (
                  <option key={group.id} value={group.id}>{'\u00a0\u00a0'.repeat(depth)}{group.name}</option>
                ))}
              </select>
            </label>
          )}
        </form>
      )}
      {groups.length === 0 && <p className="text-sm text-gray-500 text-center py-6">No moderator groups yet.</p>}
      {tree.map(({ group: g, depth }) => (
        <Card key={g.id} style={depth ? { marginLeft: depth * 16, width: `calc(100% - ${depth * 16}px)` } : undefined} className={depth ? 'border-l-4 border-l-amber-300' : ''} data-testid="group-card">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Users size={14} />{g.name} <span className="text-xs text-gray-500 font-normal">({g.members.length})</span>
              </h4>
              {canManage && (
                <span className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label={`Rename ${g.name}`}
                  className="text-gray-400 hover:text-blue-600"
                  onClick={() => {
                    const name = window.prompt('New group name', g.name)?.trim();
                    if (name && name !== g.name) run(() => api.renameModeratorGroup(g.id, name));
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${g.name}`}
                  className="text-gray-400 hover:text-red-600"
                  onClick={() => window.confirm(`Delete group “${g.name}”?`) && run(() => api.deleteModeratorGroup(g.id))}
                >
                  <Trash2 size={14} />
                </button>
                </span>
              )}
            </div>
            {g.parent_id != null && nameOf(g.parent_id) && (
              <p className="text-xs text-gray-500">Sub-group of {nameOf(g.parent_id)}</p>
            )}
            {groups.some((c) => c.parent_id === g.id) && (
              <p className="text-xs text-gray-500">Sub-groups: {groups.filter((c) => c.parent_id === g.id).map((c) => c.name).join(', ')}</p>
            )}
            <div className="flex flex-wrap gap-1">
              {g.members.map((m) => (
                <span key={m.user_id} className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 text-xs rounded-full px-2 py-0.5">
                  {m.name}
                  {canManage && (
                    <button type="button" aria-label={`Remove ${m.name}`} onClick={() => run(() => api.removeModeratorGroupMember(g.id, m.user_id))}>
                      <X size={11} />
                    </button>
                  )}
                </span>
              ))}
              {g.members.length === 0 && <span className="text-xs text-gray-400">No members yet</span>}
            </div>
            {canManage && groups.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                Under
                <select
                  data-testid="group-parent"
                  aria-label={`Parent group of ${g.name}`}
                  className="border rounded px-2 py-1 bg-white flex-1"
                  value={g.parent_id ?? ''}
                  onChange={(e) => run(() => api.setModeratorGroupParent(g.id, e.target.value ? Number(e.target.value) : null))}
                >
                  <option value="">No parent (top level)</option>
                  {(() => {
                    const blocked = descendantIds(groups, g.id);
                    return tree
                      .filter(({ group }) => group.id !== g.id && !blocked.has(group.id))
                      .map(({ group, depth: d }) => (
                        <option key={group.id} value={group.id}>{'\u00a0\u00a0'.repeat(d)}{group.name}</option>
                      ));
                  })()}
                </select>
              </label>
            )}
            {canManage && (
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input
                  className="pl-8 text-sm h-8"
                  placeholder="Add person by name or phone..."
                  value={searchGroup === g.id ? query : ''}
                  onChange={(e) => search(g.id, e.target.value)}
                />
                {searchGroup === g.id && hits.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {hits.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 border-b last:border-b-0"
                        onClick={() => run(() => api.addModeratorGroupMember(g.id, u.id)).then(() => { setQuery(''); setHits([]); })}
                      >
                        {u.name} <span className="text-xs text-gray-500">{formatPhone(u.phone)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
