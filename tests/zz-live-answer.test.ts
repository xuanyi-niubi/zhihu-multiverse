/** 临时验证（跑完即删）：把线上真实一局的数据喂进终局答案函数。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { endgameAnswerOf } from '@/features/game-world/endgameAnswer';
import type { ProblemFrame } from '@/features/experience/domain';
import type { WorldBlueprint } from '@/features/game-world/domain';

describe('live endgame answer', () => {
  it('print', () => {
    const raw = JSON.parse(readFileSync(join(process.env.TEMP ?? '.', 'mv-session-view.json'), 'utf8'));
    const frame = raw.data.problemFrame as ProblemFrame;
    const blueprint = raw.data.worldBlueprint as WorldBlueprint;

    const answer = endgameAnswerOf({
      frame,
      blueprint,
      walked: ['先去旅行社兼职两个月，确认受不受得了', '拒绝了家里安排的稳定岗位'],
      usedUnlockIds: (blueprint.unlocks ?? []).map((unlock) => unlock.id),
      experiment: raw.data.experiment ?? null,
    });

    console.log('【你问的是】', answer.question);
    console.log('【你补上的条件】', JSON.stringify(answer.conditions));
    console.log('【你走过的路】', JSON.stringify(answer.walked));
    console.log('【你采用了谁的经验】');
    for (const item of answer.taken) console.log('   •', item.quote, '——', item.author, item.sourceUrl);
    console.log('【真实的人是怎么做的】');
    for (const item of answer.borrowed) console.log('   •', item.quote, '——', item.author, item.sourceUrl);
    console.log('【他们付出的代价】');
    for (const item of answer.costs) console.log('   •', item.quote, '——', item.author);
    console.log('【走坏的那条路】', answer.counter ? `${answer.counter.quote} —— ${answer.counter.author}` : '(无)');
    console.log('【仍然不知道】', answer.unknown);
    console.log('【下一步】', answer.nextStep ? answer.nextStep.action : '(未设计实验)');
    console.log('【诚实边界】', answer.note);
  });
});
