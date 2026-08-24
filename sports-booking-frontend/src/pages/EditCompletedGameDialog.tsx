import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trophy, ArrowLeft, ArrowRight, DollarSign } from 'lucide-react';
import { Player, formatPlayerDisplay } from '@/lib/player';

interface Team {
  id: number;
  team_name: string;
  team_order: number;
}

interface GameScore {
  team_a_id: number | null; team_a_name: string; team_a_score: number;
  team_b_id: number | null; team_b_name: string; team_b_score: number;
}

interface GoalScorer {
  user_id: number;
  name: string;
  phone: string;
  goals: number;
  own_goals: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: {
    played_user_ids: number[];
    team_scores?: { team_id: number; score: number }[];
    team_assignments?: Record<number, number | null>;
    goal_scorers?: { user_id: number; goals: number; own_goals: number }[];
  }) => Promise<void>;
  allPlayers: Player[];
  teams: Team[];
  gameScore: GameScore | null;
  goalScorers: GoalScorer[];
  groundCost: number;
  currency: string;
  loading?: boolean;
}

type Step = 'players' | 'teams' | 'score' | 'scorers' | 'summary';

export default function EditCompletedGameDialog({
  open,
  onOpenChange,
  onSave,
  allPlayers,
  teams,
  gameScore,
  goalScorers,
  groundCost,
  currency,
  loading,
}: Props) {
  const [step, setStep] = useState<Step>('players');
  const [playedIds, setPlayedIds] = useState<Set<number>>(new Set());
  const [teamAssignments, setTeamAssignments] = useState<Record<number, number | null>>({});
  const [teamScores, setTeamScores] = useState<Record<number, number>>({});
  const [scorerGoals, setScorerGoals] = useState<Record<number, { goals: number; own_goals: number }>>({});

  const hasTeams = teams.length >= 2;

  useEffect(() => {
    if (open) {
      setStep('players');
      setPlayedIds(new Set(allPlayers.filter(p => p.played).map(p => p.user_id)));
      const ta: Record<number, number | null> = {};
      allPlayers.forEach(p => { ta[p.user_id] = p.team_id ?? null; });
      setTeamAssignments(ta);
      const ts: Record<number, number> = {};
      teams.forEach(t => {
        let score = 0;
        if (gameScore) {
          if (gameScore.team_a_id === t.id) score = gameScore.team_a_score;
          else if (gameScore.team_b_id === t.id) score = gameScore.team_b_score;
        }
        ts[t.id] = score;
      });
      setTeamScores(ts);
      const sg: Record<number, { goals: number; own_goals: number }> = {};
      goalScorers.forEach(s => {
        sg[s.user_id] = { goals: s.goals, own_goals: s.own_goals || 0 };
      });
      setScorerGoals(sg);
    }
  }, [open, allPlayers, teams, gameScore, goalScorers]);

  const playedPlayers = useMemo(() => allPlayers.filter(p => playedIds.has(p.user_id)), [allPlayers, playedIds]);

  const togglePlayed = (userId: number) => {
    setPlayedIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleAll = () => {
    if (playedIds.size === allPlayers.length) setPlayedIds(new Set());
    else setPlayedIds(new Set(allPlayers.map(p => p.user_id)));
  };

  const setTeam = (userId: number, teamId: string) => {
    setTeamAssignments(prev => ({ ...prev, [userId]: teamId === 'none' ? null : Number(teamId) }));
  };

  const adjustTeamScore = (teamId: number, delta: number) => {
    setTeamScores(prev => ({ ...prev, [teamId]: Math.max(0, (prev[teamId] || 0) + delta) }));
  };

  const adjustScorer = (userId: number, field: 'goals' | 'own_goals', delta: number) => {
    setScorerGoals(prev => {
      const cur = prev[userId] || { goals: 0, own_goals: 0 };
      const next = { ...cur, [field]: Math.max(0, (cur[field] || 0) + delta) };
      return { ...prev, [userId]: next };
    });
  };

  const totalTeamScore = useMemo(() => Object.values(teamScores).reduce((a, b) => a + b, 0), [teamScores]);
  const totalRegularGoals = useMemo(() =>
    playedPlayers.reduce((sum, p) => sum + (scorerGoals[p.user_id]?.goals || 0), 0),
    [playedPlayers, scorerGoals]
  );
  const totalOwnGoals = useMemo(() =>
    playedPlayers.reduce((sum, p) => sum + (scorerGoals[p.user_id]?.own_goals || 0), 0),
    [playedPlayers, scorerGoals]
  );
  const perPerson = playedIds.size > 0 ? groundCost / playedIds.size : 0;

  const canNext = () => {
    if (step === 'players') return playedIds.size > 0;
    if (step === 'teams') {
      if (!hasTeams) return true;
      return playedPlayers.every(p => teamAssignments[p.user_id] !== undefined && teamAssignments[p.user_id] !== null);
    }
    if (step === 'score') return true;
    if (step === 'scorers') return totalRegularGoals <= totalTeamScore;
    return true;
  };

  const handleNext = () => {
    if (step === 'players') setStep(hasTeams ? 'teams' : 'score');
    else if (step === 'teams') setStep('score');
    else if (step === 'score') setStep('scorers');
    else if (step === 'scorers') setStep('summary');
  };

  const handleBack = () => {
    if (step === 'summary') setStep('scorers');
    else if (step === 'scorers') setStep('score');
    else if (step === 'score') setStep(hasTeams ? 'teams' : 'players');
    else if (step === 'teams') setStep('players');
  };

  const handleSave = async () => {
    const assignments: Record<number, number | null> = {};
    playedPlayers.forEach(p => { assignments[p.user_id] = teamAssignments[p.user_id] ?? null; });
    const scores = teams.map(t => ({ team_id: t.id, score: teamScores[t.id] || 0 }));
    const scorers = playedPlayers
      .filter(p => scorerGoals[p.user_id] && (scorerGoals[p.user_id].goals > 0 || scorerGoals[p.user_id].own_goals > 0))
      .map(p => ({
        user_id: p.user_id,
        goals: scorerGoals[p.user_id].goals || 0,
        own_goals: scorerGoals[p.user_id].own_goals || 0,
      }));
    await onSave({
      played_user_ids: Array.from(playedIds),
      team_scores: teams.length > 0 ? scores : undefined,
      team_assignments: assignments,
      goal_scorers: scorers,
    });
  };

  const renderPlayersStep = () => (
    <>
      <DialogDescription>
        Select the players who actually played. Cost per player will be recalculated.
      </DialogDescription>
      <div className="flex items-center justify-between my-2">
        <Label className="text-sm font-medium text-gray-700">All players</Label>
        <button type="button" onClick={toggleAll} className="text-xs text-green-600 hover:underline">
          {playedIds.size === allPlayers.length ? 'Uncheck all' : 'Check all'}
        </button>
      </div>
      <ScrollArea className="h-[280px] border rounded-lg p-2">
        <div className="space-y-1">
          {allPlayers.map(player => (
            <div key={player.user_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
              <Checkbox
                id={`edit-player-${player.user_id}`}
                checked={playedIds.has(player.user_id)}
                onCheckedChange={() => togglePlayed(player.user_id)}
              />
              <Label htmlFor={`edit-player-${player.user_id}`} className="flex-1 text-sm font-normal cursor-pointer">
                {formatPlayerDisplay(player.name, player.phone)}
                {player.position && player.position !== 'Anywhere' ? ` (${player.position})` : ''}
              </Label>
            </div>
          ))}
          {allPlayers.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No players in this game</p>}
        </div>
      </ScrollArea>
    </>
  );

  const renderTeamsStep = () => (
    <>
      <DialogDescription>Assign each played player to a team.</DialogDescription>
      <ScrollArea className="h-[320px] border rounded-lg p-2 mt-2">
        <div className="space-y-2">
          {playedPlayers.map(player => (
            <div key={player.user_id} className="flex items-center justify-between bg-white rounded p-2">
              <span className="text-sm">{formatPlayerDisplay(player.name, player.phone)}</span>
              <Select
                value={teamAssignments[player.user_id] === null || teamAssignments[player.user_id] === undefined ? 'none' : String(teamAssignments[player.user_id])}
                onValueChange={(val) => setTeam(player.user_id, val)}
              >
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue placeholder="Team" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No team</SelectItem>
                  {teams.map(t => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.team_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </ScrollArea>
    </>
  );

  const renderScoreStep = () => (
    <>
      <DialogDescription>Enter the final score for each team.</DialogDescription>
      <div className="space-y-3 mt-2">
        {teams.map(team => (
          <div key={team.id} className="flex items-center gap-3">
            <Label className="w-32 text-sm font-medium">{team.team_name}</Label>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0"
                onClick={() => adjustTeamScore(team.id, -1)}>-</Button>
              <span className="w-8 text-center font-bold text-lg">{teamScores[team.id] || 0}</span>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0"
                onClick={() => adjustTeamScore(team.id, 1)}>+</Button>
            </div>
          </div>
        ))}
        {teams.length === 0 && <p className="text-sm text-gray-500">No teams created for this game.</p>}
      </div>
      <p className="text-xs text-purple-600 mt-2">Total goals: {totalTeamScore}</p>
    </>
  );

  const renderScorersStep = () => (
    <>
      <DialogDescription>
        Record goals and own goals. Own goals count against the scorer's team.
      </DialogDescription>
      <p className="text-xs text-purple-600 my-2">
        Team goals: {totalTeamScore} | Regular goals: {totalRegularGoals} | Own goals: {totalOwnGoals}
        {totalRegularGoals > totalTeamScore && (
          <span className="text-red-600 ml-2">Regular goals cannot exceed team goals.</span>
        )}
      </p>
      <ScrollArea className="h-[260px] border rounded-lg p-2">
        <div className="space-y-2">
          {playedPlayers.map(player => {
            const goals = scorerGoals[player.user_id]?.goals || 0;
            const own = scorerGoals[player.user_id]?.own_goals || 0;
            return (
              <div key={player.user_id} className="flex items-center justify-between bg-white rounded p-2">
                <span className="text-sm">{formatPlayerDisplay(player.name, player.phone)}</span>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500">Goals</span>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-xs"
                      disabled={goals === 0}
                      onClick={() => adjustScorer(player.user_id, 'goals', -1)}>-</Button>
                    <span className="w-5 text-center text-sm font-semibold">{goals}</span>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-xs"
                      disabled={totalRegularGoals >= totalTeamScore}
                      onClick={() => adjustScorer(player.user_id, 'goals', 1)}>+</Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-red-500">Own</span>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-xs"
                      disabled={own === 0}
                      onClick={() => adjustScorer(player.user_id, 'own_goals', -1)}>-</Button>
                    <span className="w-5 text-center text-sm font-semibold text-red-600">{own}</span>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-xs"
                      onClick={() => adjustScorer(player.user_id, 'own_goals', 1)}>+</Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </>
  );

  const renderSummaryStep = () => (
    <>
      <DialogDescription>Review the updated game result before saving.</DialogDescription>
      <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm mt-2">
        <div className="flex justify-between text-gray-600">
          <span>Players who played</span>
          <span>{playedIds.size}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Ground cost</span>
          <span>{groundCost.toFixed(2)} {currency}</span>
        </div>
        <div className="flex justify-between items-center pt-2 border-t border-gray-200">
          <span className="font-semibold text-gray-800 flex items-center gap-1">
            <DollarSign size={14} /> Per player
          </span>
          <span className="font-bold text-green-700">{perPerson.toFixed(2)} {currency}</span>
        </div>
        {hasTeams && (
          <>
            <div className="flex justify-between text-gray-600 pt-2 border-t border-gray-200">
              <span>Score</span>
              <span>{teams.map(t => `${t.team_name} ${teamScores[t.id] || 0}`).join(' - ')}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Regular / own goals</span>
              <span>{totalRegularGoals} / {totalOwnGoals}</span>
            </div>
          </>
        )}
      </div>
    </>
  );

  const steps: { key: Step; label: string }[] = [
    { key: 'players', label: 'Players' },
    ...(hasTeams ? [{ key: 'teams' as Step, label: 'Teams' }] : []),
    { key: 'score', label: 'Score' },
    { key: 'scorers', label: 'Scorers' },
    { key: 'summary', label: 'Summary' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy size={18} /> Edit Game Result
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 text-[10px] text-gray-400 mb-2">
          {steps.map((s, idx) => (
            <span key={s.key} className={step === s.key ? 'font-bold text-purple-700' : ''}>
              {idx + 1}. {s.label}
            </span>
          ))}
        </div>

        <div className="flex-1 min-h-0 py-2">
          {step === 'players' && renderPlayersStep()}
          {step === 'teams' && renderTeamsStep()}
          {step === 'score' && renderScoreStep()}
          {step === 'scorers' && renderScorersStep()}
          {step === 'summary' && renderSummaryStep()}
        </div>

        <DialogFooter className="mt-4 gap-2">
          {step !== 'players' ? (
            <Button variant="outline" className="flex-1" onClick={handleBack}>
              <ArrowLeft size={14} className="mr-1" /> Back
            </Button>
          ) : (
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          {step !== 'summary' ? (
            <Button className="flex-1 bg-purple-600 hover:bg-purple-700" disabled={!canNext()} onClick={handleNext}>
              Next <ArrowRight size={14} className="ml-1" />
            </Button>
          ) : (
            <Button className="flex-1 bg-purple-600 hover:bg-purple-700" disabled={loading} onClick={handleSave}>
              {loading ? 'Saving...' : 'Save Result'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
