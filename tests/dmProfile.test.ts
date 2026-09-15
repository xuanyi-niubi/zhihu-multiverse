import { describe, expect, it } from 'vitest';

import {
  extractProfile,
  normalizeProfile,
  parseProfileText,
  profileToPromptBlock,
} from '@/core/dm/profile';

/**
 * 处境档案测试。
 *
 * 两条路径都要覆盖：
 * - `normalizeProfile`：模型返回的开放结果如何被钳制
 * - `extractProfile`：模型不可用时的确定性兜底
 */

describe('extractProfile（确定性兜底）', () => {
  it('离线规则保留电工与导游，不退化成泛化目标', () => {
    const profile = extractProfile('我是电工专业，然后想转导游');
    expect(profile.background).toContain('电工');
    expect(profile.target).toContain('导游');
  });

  it('通用句式同样能保留非职业问题', () => {
    const profile = extractProfile('我和室友长期冲突，想搬宿舍');
    expect(profile.background).toContain('室友长期冲突');
    expect(profile.target).toContain('搬宿舍');
  });

  it('从「大三法学，想转计算机，但怕脱产找不到工作」抽出关键处境', () => {
    const profile = extractProfile('大三法学，想转计算机，但怕脱产找不到工作');

    expect(profile.background).toContain('法学');
    expect(profile.background).toContain('大三');
    expect(profile.target).toContain('技术');
    expect(profile.constraints.join('')).toContain('脱产');
    expect(profile.fears.length).toBeGreaterThan(0);
    expect(profile.riskAppetite).toBe('low');
    expect(profile.arc).toHaveLength(4);
    expect(profile.keyTension).toContain('技术岗');
  });

  it('识别「敢赌」型风险偏好', () => {
    expect(extractProfile('双非本科，想死磕大厂算法岗').riskAppetite).toBe('high');
  });

  it('中性表述落到 medium', () => {
    expect(extractProfile('大三在读，考虑考研').riskAppetite).toBe('medium');
  });

  it('完全无法识别的文本也能给出结构完整的结果', () => {
    const profile = extractProfile('随便写点什么');

    expect(profile.background.length).toBeGreaterThan(0);
    expect(profile.target.length).toBeGreaterThan(0);
    expect(profile.keyTension.length).toBeGreaterThan(0);
    expect(profile.arc).toHaveLength(4);
  });

  it('空输入不抛异常', () => {
    expect(() => extractProfile('')).not.toThrow();
    expect(extractProfile('').arc).toHaveLength(4);
  });

  it('四幕主题绑定了真实约束/恐惧', () => {
    const profile = extractProfile('二战考研，家里催得紧，怕撑不住');

    const arcText = profile.arc.join(' ');
    expect(arcText.length).toBeGreaterThan(20);
    expect(profile.constraints.length + profile.fears.length).toBeGreaterThan(0);
  });
});

describe('normalizeProfile（模型输出钳制）', () => {
  const valid = {
    background: '法学 大三',
    target: '转计算机',
    constraints: ['不能脱产'],
    fears: ['怕找不到工作'],
    resources: ['自学过 Python'],
    keyTension: '想转计算机，但不能脱产。',
    riskAppetite: 'low',
    arc: ['起步', '打击', '压力', '收束'],
  };

  it('合法输入原样通过', () => {
    const profile = normalizeProfile(valid);

    expect(profile).not.toBeNull();
    expect(profile?.background).toBe('法学 大三');
    expect(profile?.arc).toHaveLength(4);
  });

  it('缺少必填项时返回 null（触发兜底）', () => {
    expect(normalizeProfile({ ...valid, background: '' })).toBeNull();
    expect(normalizeProfile({ ...valid, keyTension: undefined })).toBeNull();
    expect(normalizeProfile(null)).toBeNull();
    expect(normalizeProfile('字符串')).toBeNull();
  });

  it('arc 不是 4 条时返回 null', () => {
    expect(normalizeProfile({ ...valid, arc: ['一', '二'] })).toBeNull();
    expect(normalizeProfile({ ...valid, arc: '不是数组' })).toBeNull();
  });

  it('列表超长被截断，非字符串项被丢弃', () => {
    const profile = normalizeProfile({
      ...valid,
      constraints: ['a', 'b', 'c', 'd', 'e', 42, null],
    });

    expect(profile?.constraints).toHaveLength(4);
    expect(profile?.constraints.every((item) => typeof item === 'string')).toBe(true);
  });

  it('非法 riskAppetite 回落到 medium', () => {
    expect(normalizeProfile({ ...valid, riskAppetite: '疯狂' })?.riskAppetite).toBe('medium');
    expect(normalizeProfile({ ...valid, riskAppetite: 'high' })?.riskAppetite).toBe('high');
  });

  it('字符串字段超长被截断', () => {
    const profile = normalizeProfile({ ...valid, background: '啊'.repeat(200) });

    expect(profile?.background.length).toBeLessThanOrEqual(40);
  });
});

describe('parseProfileText（模型逐行输出）', () => {
  const GOOD = `背景：知识产权在读
目标：具身智能机器人
约束：家里希望考公；跨专业门槛高
恐惧：怕两头都耽误
资源：法学背景，会写检索报告
核心矛盾：想进机器人行业，但家里要稳定编制
风险偏好：low
四幕：起步：先摸清行业门槛；现实打击：投简历无人回应；外部压力：家里催考公；收束：在编制与机器人之间做选择`;

  it('解析标准 8 行输出', () => {
    const profile = parseProfileText(GOOD);

    expect(profile).not.toBeNull();
    expect(profile?.background).toBe('知识产权在读');
    expect(profile?.target).toBe('具身智能机器人');
    expect(profile?.constraints).toHaveLength(2);
    expect(profile?.riskAppetite).toBe('low');
    expect(profile?.arc).toHaveLength(4);
  });

  it('容忍 markdown 粗体、标题符号与全角冒号', () => {
    const messy = GOOD.replace(/\*/g, '')
      .split('\n')
      .map((line) => `**${line.replace('：', '：')}**`)
      .join('\n');

    expect(parseProfileText(`# 档案\n${messy}`)).not.toBeNull();
  });

  it('容忍列表符号与顿号分隔', () => {
    const profile = parseProfileText(
      `- 背景：法学大三\n- 目标：转码\n- 约束：不能脱产、家里催\n- 恐惧：怕找不到工作\n- 资源：\n- 核心矛盾：想转码，但不能脱产\n- 风险偏好：低\n- 四幕：a；b；c；d`,
    );

    expect(profile?.constraints).toEqual(['不能脱产', '家里催']);
    expect(profile?.riskAppetite).toBe('low');
  });

  it('缺少必填项或四幕不足时返回 null', () => {
    expect(parseProfileText('背景：法学\n目标：转码')).toBeNull();
    expect(parseProfileText(GOOD.replace(/四幕：.*/, '四幕：a；b'))).toBeNull();
    expect(parseProfileText('')).toBeNull();
    expect(parseProfileText(null)).toBeNull();
  });

  it('英文 riskAppetite 也能识别', () => {
    expect(parseProfileText(GOOD.replace('low', 'high'))?.riskAppetite).toBe('high');
    expect(parseProfileText(GOOD.replace('low', '随便'))?.riskAppetite).toBe('medium');
  });
});

describe('profileToPromptBlock', () => {
  it('渲染出所有关键字段与四幕设计', () => {
    const block = profileToPromptBlock(extractProfile('大三法学，想转计算机，但怕脱产找不到工作'));

    expect(block).toContain('现状');
    expect(block).toContain('核心矛盾');
    expect(block).toContain('四幕冲突设计');
    expect(block).toContain('风险偏好');
  });
});
