(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RecordWriter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // NEIS 입력 단위는 바이트이며 한글 1자=3바이트. 과세특 500자·행동특성 300자 기준.
  const LIMITS = { subjectNote: 1500, homeroom: 900 };
  const NOMINAL_END = /(함|음|임|됨|남|짐|큼)\.$/;
  const CONNECTORS = ['', '', '또한 ', '특히 ', '아울러 '];
  // 30명 무작위 보정 결과: 0.75는 쌍 14개가 걸려 과다, 0.8 이상은 소수만 걸림
  const DUPLICATE_THRESHOLD = 0.8;
  const KEYWORD_STOP = new Set(['하고', '있다', '있는', '있으며', '수', '등', '의', '및', '이해', '활용', '통해', '위해', '대한', '한다', '할', '것', '하여', '따라', '관련', '과정', '방법', '내용']);
  const JOSA_SUFFIX = /(에서|으로|에게|까지|부터|이나|이고|이며|은|는|이|가|을|를|의|에|와|과|로|도)$/;
  const VERB_END = /(하고|하며|하여|하는|한다|할|한|된다|되는|되고|있다|있는|있음|했다|하다)$/;

  const LEVEL_SENTENCES = {
    A: [
      '성취기준의 핵심 개념을 정확히 이해하고 이를 새로운 상황에 응용하는 능력이 뛰어남',
      '학습 목표를 명확히 파악하고 완성도 높은 결과물로 성취를 입증함',
      '개념 이해가 깊고 문제 해결 과정을 논리적으로 설명할 수 있는 수준에 도달함'
    ],
    B: [
      '성취기준에 대한 기본 개념을 잘 이해하고 과제 해결에 적극적으로 활용함',
      '학습 내용을 대체로 정확히 이해하며 수행 과정에서 꾸준히 성취를 쌓아감',
      '핵심 개념을 바탕으로 과제를 수행하며 안정적인 학습 성취를 보임'
    ],
    C: [
      '기본 개념을 익히기 위해 꾸준히 노력하며 과제를 끝까지 완수하려는 태도가 있음',
      '학습 내용에 대한 이해를 넓히기 위해 반복 학습에 성실하게 참여함',
      '기초 개념을 차근차근 쌓아 가며 학습 성취를 높여 나가는 모습을 보임'
    ],
    D: [
      '기초 개념을 다지는 데 노력이 더 필요하나 학습에 임하는 자세가 성실함',
      '기본 내용을 보완하기 위해 질문과 연습을 반복하며 학습 의지를 보임'
    ],
    E: [
      '기초 개념 보완이 필요한 단계이나 교사의 안내에 따라 학습을 이어 가려는 의지를 보임',
      '기본 내용을 익히기 위해 수업 참여를 늘리려는 노력이 보임'
    ]
  };

  const ARTS_LEVEL = {
    A: [
      '실기 기능이 숙련되어 표현의 완성도가 높음',
      '실기 과제를 정확한 절차와 감각으로 수행하는 능력이 뛰어남'
    ],
    B: [
      '실기 기능을 안정적으로 익혀 과제를 무리 없이 수행함',
      '실기 활동에서 표현 방법을 익혀 결과물의 완성도를 높여 감'
    ],
    C: [
      '기본 실기 동작을 익히며 꾸준히 연습하는 모습을 보임',
      '기초 기능을 반복 연습하며 과제 수행력을 키워 감'
    ],
    D: [
      '실기 기초를 다지는 연습이 더 필요하나 수업 참여 태도가 성실함'
    ],
    E: [
      '실기 기초 연습에 꾸준히 참여하며 기능 향상을 위해 노력함'
    ]
  };

  const APTITUDE_SENTENCES = [
    '교과 적성이 뚜렷하여 관련 활동에 흥미를 가지고 참여함',
    '이 분야에 대한 관심과 소질이 있어 활동 의욕이 높음'
  ];

  const PRACTICAL_INTRO = {
    A: '{s} 실무 학습에 적극적으로 참여하며 수행 태도가 매우 성실함',
    B: '{s} 실무 학습에 성실하게 참여하며 수행 태도가 안정적임',
    C: '{s} 실무 학습에 꾸준히 참여하며 기본 수행 태도를 익혀 감',
    D: '{s} 실무 학습에 참여하는 태도가 성실하며 수행 능력 향상이 기대됨',
    E: '{s} 실무 학습에 참여하는 태도가 성실하며 수행 능력 향상이 기대됨'
  };

  const UNIT_TAILS = [
    '수행 태도가 성실하고 작업 절차를 정확히 지킴',
    '학습활동 참여도가 높고 맡은 과제를 끝까지 완수함',
    '기능을 익히려는 적극적인 태도로 결과물의 완성도를 높임'
  ];

  const CLOSING_SENTENCES = {
    A: [
      '앞으로도 탐구하는 열정을 이어 간다면 더욱 깊이 있는 성장이 기대됨',
      '학습한 내용을 실생활과 연결하는 힘이 있어 향후 발전 가능성이 큼'
    ],
    B: [
      '꾸준한 노력이 더해진다면 학습 성취가 한층 향상될 것으로 기대됨',
      '기본기를 바탕으로 심화 학습에도 자신감 있게 도전할 것으로 보임'
    ],
    C: [
      '기초를 차근차근 다져 나간다면 학습 자신감이 더욱 커질 것으로 기대됨',
      '꾸준한 반복 학습으로 성취도가 향상될 가능성이 충분함'
    ],
    D: [
      '기초를 다지는 과정에서 학습 자신감이 자라날 것으로 기대됨'
    ],
    E: [
      '작은 성취를 쌓아 가며 학습 자신감을 키워 나갈 것으로 기대됨'
    ]
  };

  const FOCUS_TAILS = [
    '성취기준에 맞는 수행 능력을 보임',
    '교과 개념을 실제 과제에 적용하는 모습을 보임',
    '핵심 원리를 설명하며 과제를 해결함'
  ];

  const SUBJECT_TAGS = {
    탐구: [
      '주어진 문제를 스스로 탐구하며 원인을 분석하려는 자세가 돋보임',
      '궁금한 점을 탐색 질문으로 정리해 해결 방법을 찾아 나가는 힘이 있음',
      '자료를 비교하고 근거를 찾아 결론을 도출하는 탐구 태도가 뛰어남'
    ],
    발표: [
      '자신의 생각을 조리 있게 발표하고 질의응답에도 적극적으로 참여함',
      '발표 자료를 논리적으로 구성하여 핵심을 간결하게 전달함',
      '친구의 발표에 질문을 던지며 토론을 이끌어 가는 모습을 보임'
    ],
    협업: [
      '모둠 활동에서 역할을 분담하고 동료의 의견을 존중하며 협력함',
      '의견이 엇갈릴 때 대안을 제시하며 모둠의 결론을 함께 만들어 냄',
      '모둠원의 역량을 살피며 과제가 원활하게 진행되도록 도움'
    ],
    실습: [
      '실습 과정에서 절차를 정확히 지키며 작업 숙련도가 꾸준히 향상됨',
      '도구와 장비를 바르게 사용하며 결과물의 완성도를 높이는 능력이 있음',
      '실습 결과를 기록하고 개선점을 찾아 다음 실습에 반영함'
    ],
    성실: [
      '수업 준비와 과제 제출에 성실하며 학습 계획을 꾸준히 실천함',
      '정해진 기한을 지키며 맡은 과제를 끝까지 책임 있게 마무리함',
      '수업 시간마다 집중하여 참여하는 태도가 한결같음'
    ],
    문제해결: [
      '오류가 생겼을 때 원인을 찾아 스스로 수정하는 문제 해결력이 있음',
      '여러 해결 방법을 비교하여 가장 효율적인 방법을 선택함',
      '막히는 부분을 단계별로 나누어 해결해 나가는 과정이 체계적임'
    ],
    안전: [
      '작업 안전 수칙과 실습실 규칙을 꼼꼼히 지키는 태도가 돋보임',
      '위험 요소를 미리 점검하고 주변과 함께 안전을 확인하는 습관이 있음'
    ],
    창의: [
      '새로운 방법을 시도하며 결과물에 자신만의 아이디어를 더함',
      '기존 방식에서 벗어나 독창적인 해결책을 제시하려는 시도가 돋보임'
    ],
    자기주도: [
      '목표를 스스로 세우고 학습 진도를 관리하며 자기주도적으로 공부함',
      '부족한 부분을 스스로 찾아 보충하는 학습 습관이 잘 잡혀 있음'
    ],
    질문: [
      '궁금한 점을 질문으로 정리해 해결하려는 적극성이 있음',
      '수업 중 질문을 통해 개념을 확실히 하려는 모습이 자주 보임'
    ]
  };

  const TRAIT_SENTENCES = {
    성실: [
      '맡은 일을 미루지 않고 성실하게 끝까지 해내는 태도가 있음',
      '약속한 일을 정해진 기한 안에 책임감 있게 마무리함',
      '꾸준한 노력으로 학습과 학급 활동에 성실하게 참여함'
    ],
    책임: [
      '자신의 역할을 충실히 수행하며 맡은 일에 책임감이 강함',
      '맡은 일의 결과를 스스로 점검하고 부족한 부분을 채우려고 노력함'
    ],
    협력: [
      '친구들과 협력하여 공동의 목표를 이루려는 자세가 돋보임',
      '모둠 활동에서 의견을 조율하며 원만하게 협력함'
    ],
    배려: [
      '주변 친구를 세심하게 배려하고 어려움을 함께 나누려는 마음이 따뜻함',
      '친구의 입장을 먼저 생각하고 도움이 필요한 순간에 먼저 손을 내미는 배려심이 있음'
    ],
    리더십: [
      '학급 활동에서 솔선수범하여 친구들을 이끄는 리더십이 있음',
      '의견을 모으는 과정에서 조용히 중심을 잡아 주는 역할을 함'
    ],
    자기주도: [
      '스스로 목표를 세우고 실천 과정을 점검하는 자기주도성이 뛰어남',
      '필요한 것을 스스로 찾아 해결하려는 주도적인 태도가 있음'
    ],
    소통: [
      '상대의 말을 끝까지 경청하고 자신의 생각을 예의 바르게 표현함',
      '대화에서 상대의 의견을 존중하며 생각을 차분하게 전달함'
    ],
    규칙: [
      '학교 생활 규칙과 약속을 잘 지키며 바른 생활 습관이 몸에 배어 있음',
      '공동 생활의 질서를 존중하고 스스로 지키려는 태도가 분명함'
    ],
    호기심: [
      '새로운 내용에 호기심이 많아 적극적으로 질문하고 탐구하려는 태도가 있음',
      '배움에 대한 열린 자세로 여러 분야에 관심을 넓혀 가는 모습을 보임'
    ],
    긍정: [
      '어려운 상황에서도 긍정적인 태도를 잃지 않고 끈기 있게 도전함',
      '실수를 두려워하지 않고 다시 시도하며 배움을 이어 가는 힘이 있음'
    ]
  };

  const TRAIT_GROUP = {
    성실: '책임', 책임: '책임',
    협력: '관계', 배려: '관계', 소통: '관계',
    리더십: '주도', 자기주도: '주도',
    호기심: '탐구', 긍정: '태도', 규칙: '규칙'
  };

  const HOMEROOM_GROWTH = [
    '생활 태도가 점차 안정되며 스스로 개선하려는 노력이 눈에 띔',
    '학급 활동에 참여하는 폭이 넓어지며 자신감이 한층 높아진 모습임',
    '어려움을 스스로 극복하려는 의지가 점점 분명해지고 있음'
  ];

  const HOMEROOM_CLOSING = [
    '학급 생활 전반에서 긍정적인 모습이 두드러져 앞으로의 성장이 기대됨',
    '밝은 에너지로 주변에 좋은 영향을 주는 학생으로, 꾸준한 발전이 기대됨',
    '자신의 강점을 살려 학교생활을 주도적으로 이끌어 갈 것으로 보임'
  ];

  function byteLen(s) {
    let n = 0;
    for (const ch of s) n += ch.charCodeAt(0) < 128 ? 1 : 3;
    return n;
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function pick(list, key) {
    return list[hash(key) % list.length];
  }

  function jongseong(word) {
    const s = String(word).trim();
    const c = s.charCodeAt(s.length - 1);
    if (c < 0xAC00 || c > 0xD7A3) return null;
    return (c - 0xAC00) % 28;
  }

  function josa(word, pair) {
    const [a, b] = pair.split('/');
    const j = jongseong(word);
    if (j === null) return b;
    if (pair === '으로/로') return j === 0 || j === 8 ? b : a;
    return j === 0 ? b : a;
  }

  const TO_NOMINAL = [
    [/한다\.?$/, '함.'],
    [/된다\.?$/, '됨.'],
    [/이다\.?$/, '임.'],
    [/보인다\.?$/, '보임.'],
    [/난다\.?$/, '남.'],
    [/는다\.?$/, '음.'],
    [/다\.?$/, '음.']
  ];

  function toNominal(sentence) {
    let s = String(sentence || '').trim().replace(/\s+/g, ' ');
    if (!s) return { text: '', changed: false };
    if (NOMINAL_END.test(s)) return { text: s, changed: false };
    s = s.replace(/\.+$/, '');
    for (const [re, rep] of TO_NOMINAL) {
      if (re.test(s + '.')) {
        return { text: (s + '.').replace(re, rep), changed: true };
      }
    }
    return { text: s + '.', changed: false };
  }

  const RULES = [
    { code: 'lang-test', level: 'error', re: /TOEIC|TOEFL|TEPS|HSK|JPT|JLPT|DELF|DALF|TESTDAF|TORFL|DELE|YBM|한자능력검정|실용한자|한자급수|상공회의소한자|한자자격검정|공인어학|어학시험/i, message: '공인어학시험·한자시험 관련 내용은 기재할 수 없음' },
    { code: 'contest', level: 'error', re: /대회|경시|올림피아드|공모전|입상|수상|표창|감사장|공로상|금상|은상|동상|장려상|최우수상/, message: '대회·수상 내용은 수상경력 외 항목에 기재할 수 없음' },
    { code: 'score', level: 'error', re: /원점수|석차|백분위|모의고사|학력평가|\d+\s*등급|등급\s*\d/, message: '성적·석차·등급 관련 내용은 기재할 수 없음' },
    { code: 'paper', level: 'error', re: /논문|학회|투고|등재|학술지/, message: '논문 투고·등재·학회 발표 내용은 기재할 수 없음' },
    { code: 'book', level: 'error', re: /저서|도서\s*출간|책을\s*(펴|냄)/, message: '저서·도서 출간 내용은 기재할 수 없음' },
    { code: 'ip', level: 'error', re: /특허|실용신안|상표\s*등록|디자인\s*등록|지식재산/, message: '지식재산권 관련 내용은 기재할 수 없음' },
    { code: 'overseas', level: 'error', re: /해외|어학연수|유학|국외\s*(활동|연수|체험)|외국\s*(체험|연수|어학)/, message: '해외 활동 관련 내용은 기재할 수 없음' },
    { code: 'scholarship', level: 'error', re: /장학금|장학생|장학/, message: '장학생·장학금 관련 내용은 기재할 수 없음' },
    { code: 'cert', level: 'error', re: /자격증|기능사|산업기사|기능장|ITQ|컴퓨터활용능력|자격\s*취득|국가공인/, message: '자격증 명칭·취득 사실은 자격증 항목 외에 기재할 수 없음' },
    { code: 'family', level: 'error', re: /부모|아버지|어머니|아빠|엄마|부모님|가정형편|집안\s*형편/, message: '부모·가정 환경 암시 내용은 기재할 수 없음' },
    { code: 'job', level: 'warn', re: /직업|직장|직위|직종|사업체/, message: '직업·직장명은 부모의 지위를 암시하지 않도록 확인' },
    { code: 'after-school', level: 'error', re: /방과후|방과\s*후|K-?MOOC|MOOC|KOCW|온라인\s*강의|인터넷\s*강의/i, message: '방과후학교·온라인 강의 내용은 기재할 수 없음' },
    { code: 'research', level: 'error', re: /소논문|연구보고서/, message: '소논문·연구보고서 내용은 기재할 수 없음' },
    { code: 'org', level: 'warn', re: /대학교|대학|학원|연구원|협회|재단법인|센터|강사/, message: '구체적인 대학·기관·강사명이 아닌지 확인' },
    { code: 'exaggerate', level: 'warn', re: /탁월|완벽|최고|천재|독보적|압도적/, message: '과장·부풀림 표현이 아닌지 확인' },
    { code: 'special-char', level: 'warn', re: /[★☆◆◇■□●○▶►→※]/, message: '특수문자는 지양' },
    { code: 'list-format', level: 'warn', re: /(^|\n)\s*([-•*]|\d+[.)]|\()\s/, message: '번호·기호 목록 형식은 지양' }
  ];

  const HOMEROOM_RULES = [
    { code: 'homeroom-career', level: 'error', re: /진로|진학|장래|희망s*직업|취업|직업|대학s*(진학|입학)|학과s*선택/, message: '행동특성 및 종합의견에는 진로 내용을 기재할 수 없음 (진로는 진로활동 항목에 기재)' },
    { code: 'homeroom-study', level: 'error', re: /학업|성적|성취도|석차|등급|점수|학력|시험|모의고사|공부s*성과/, message: '행동특성 및 종합의견에는 학업·성적 내용을 기재할 수 없음 (교과학습 항목에 기재)' }
  ];

  function splitSentences(text) {
    return String(text).split(/\.\s*/).map(s => s.trim()).filter(Boolean);
  }

  function checkText(text, opts) {
    const o = opts || {};
    const out = [];
    const t = String(text || '');
    for (const r of RULES) {
      const m = t.match(r.re);
      if (m) out.push({ level: r.level, code: r.code, match: m[0], message: r.message });
    }
    if (o.context === 'homeroom') {
      for (const r of HOMEROOM_RULES) {
        const m = t.match(r.re);
        if (m) out.push({ level: r.level, code: r.code, match: m[0], message: r.message });
      }
    }
    (o.schoolNames || []).forEach(name => {
      if (name && t.includes(name)) {
        out.push({ level: 'error', code: 'school-name', match: name, message: '학교명·학교 별칭은 기재할 수 없음' });
      }
    });
    const named = t.match(/[가-힣A-Za-z0-9]+(고등학교|고교)/);
    if (named) out.push({ level: 'warn', code: 'school-pattern', match: named[0], message: '특정 학교명 형태인지 확인' });
    splitSentences(t).forEach(s => {
      if (!NOMINAL_END.test(s + '.')) {
        out.push({ level: 'warn', code: 'ending', match: s, message: '명사형 종결(~함·~음·~임)이 아님' });
      }
    });
    if (byteLen(t) > (o.limit || LIMITS.subjectNote)) {
      out.push({ level: 'error', code: 'bytes', match: '', message: '입력 한도(바이트)를 초과함' });
    }
    return out;
  }

  const CONFIRM_ITEMS = [
    '사례는 교사가 직접 관찰·평가한 내용인가',
    '학생의 실제 수행과 다른 과장 표현은 없는가',
    '학생이 작성한 문장을 그대로 옮긴 것은 아닌가',
    'AI로 생성한 문장을 그대로 붙인 것은 아닌가',
    '학교명·대회·자격증·해외 활동 등 기재 불가 내용이 없는가'
  ];

  function buildFocus(keywords, key) {
    const kws = [...new Set(keywords.map(k => String(k).trim()).filter(Boolean))];
    if (!kws.length) return null;
    const last = kws[kws.length - 1];
    const head = kws.length > 1 ? kws.slice(0, -1).join(', ') + ' 및 ' + last : last;
    return head + josa(last, '을/를') + ' 중심으로 한 학습 활동에서 ' + pick(FOCUS_TAILS, key) + '.';
  }

  function render(parts) {
    return parts.map(p => p.text).join(' ');
  }

  function trimToLimit(parts, limit) {
    const dropped = [];
    while (byteLen(render(parts)) > limit) {
      let idx = -1;
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].prio >= 2 && (idx === -1 || parts[i].prio >= parts[idx].prio)) idx = i;
      }
      if (idx === -1) break;
      dropped.push(parts[idx].text);
      parts.splice(idx, 1);
    }
    return dropped;
  }

  function hasText(list) {
    return (list || []).some(e => String(e).trim());
  }

  function evidenceParts(list, key, prio) {
    const out = [];
    (list || []).forEach((e, i) => {
      const t = toNominal(e).text;
      if (t) out.push({ role: 'evidence', prio, text: pick(CONNECTORS, key + 'E' + i) + t });
    });
    return out;
  }

  function tagParts(tags, maxTags, key) {
    const out = [];
    (tags || []).slice(0, maxTags).forEach((tag, i) => {
      const bank = SUBJECT_TAGS[tag];
      if (!bank) return;
      out.push({ role: 'tag', prio: 3, text: pick(CONNECTORS, key + 'T' + i) + pick(bank, key + 'TS' + tag) + '.' });
    });
    return out;
  }

  function finish(parts, limit, o) {
    const dropped = trimToLimit(parts, limit);
    const text = render(parts);
    return {
      text,
      bytes: byteLen(text),
      limit,
      dropped,
      sentences: parts.map(p => ({ role: p.role, text: p.text })),
      warnings: checkText(text, { schoolNames: o.schoolNames, limit, context: o.context }),
      confirm: CONFIRM_ITEMS
    };
  }

  // kind: 'general'(일반 교과) | 'arts'(체육·예술 실기) | 'practical'(전문교과 실무 능력단위)
  function sentenceOf(prefix, body) {
    return prefix + String(body).replace(/\.+$/, '') + '.';
  }

  // profile: { subject, kind, levels: {A..E: 교사가 쓴 성취수준 기술}, keywords, units }
  // 과목명·기본 자료는 프로필에서 가져오고, 프로필이 없으면 입력값을 그대로 쓴다.
  function composeSubjectNote(input) {
    const o0 = input || {};
    const p = o0.profile || {};
    const o = Object.assign({}, o0, {
      subject: p.subject || o0.subject,
      kind: p.kind || o0.kind,
      keywords: [].concat(p.keywords || [], o0.keywords || []),
      units: [].concat(p.units || [], o0.units || [])
    });
    const kind = o.kind || 'general';
    const subject = String(o.subject || '').trim();
    const level = (o.level && LEVEL_SENTENCES[o.level]) ? o.level : 'B';
    const teacherLevel = p.levels && p.levels[level] ? toNominal(p.levels[level]).text : '';
    const key = subject + '|' + String(o.seed || '');
    const limit = o.maxBytes || LIMITS.subjectNote;
    const parts = [];
    const maxTags = o.maxTags || (hasText(o.evidence) ? 1 : 2);

    if (kind === 'practical') {
      const intro = teacherLevel
        ? sentenceOf(subject + ' 실무 학습에서 ', teacherLevel)
        : sentenceOf('', PRACTICAL_INTRO[level].replace('{s}', subject));
      parts.push({ role: 'level', prio: 1, text: intro });
      (o.units || []).map(u => String(u).trim()).filter(Boolean).forEach((u, i) => {
        parts.push({ role: 'unit', prio: 1, text: u + josa(u, '을/를') + ' 능력단위로 한 학습활동에 참여하며 ' + pick(UNIT_TAILS, key + 'U' + i) + '.' });
      });
      parts.push(...evidenceParts(o.evidence, key, 1));
      parts.push(...tagParts(o.tags, maxTags, key));
      if (o.hasGrowth !== false) {
        parts.push({ role: 'closing', prio: 4, text: pick(CLOSING_SENTENCES[level], key + 'C') + '.' });
      }
      return finish(parts, limit, o);
    }

    if (kind === 'arts') {
      const lv = ARTS_LEVEL[o.level] ? o.level : 'B';
      parts.push({ role: 'level', prio: 1, text: teacherLevel ? sentenceOf(subject + ' 교과 실기에서 ', teacherLevel) : sentenceOf(subject + ' 교과 실기에서 ', pick(ARTS_LEVEL[lv], key + 'A')) });
      if (o.aptitude) parts.push({ role: 'aptitude', prio: 2, text: pick(APTITUDE_SENTENCES, key + 'P') + '.' });
      parts.push(...evidenceParts(o.evidence, key, 1));
      parts.push(...tagParts(o.tags, maxTags, key));
      if (o.hasGrowth !== false) {
        parts.push({ role: 'closing', prio: 4, text: pick(CLOSING_SENTENCES[lv], key + 'C') + '.' });
      }
      return finish(parts, limit, o);
    }

    parts.push({ role: 'level', prio: 1, text: teacherLevel ? sentenceOf(subject + ' 교과 학습에서 ', teacherLevel) : sentenceOf(subject + ' 교과 학습에서 ', pick(LEVEL_SENTENCES[level], key + 'L')) });
    const focus = buildFocus(o.keywords || [], key + 'F');
    if (focus) parts.push({ role: 'focus', prio: 2, text: focus });
    parts.push(...evidenceParts(o.evidence, key, 1));
    parts.push(...tagParts(o.tags, maxTags, key));
    if (o.hasGrowth !== false) {
      parts.push({ role: 'closing', prio: 4, text: pick(CLOSING_SENTENCES[level], key + 'C') + '.' });
    }
    return finish(parts, limit, o);
  }

  function composeHomeroom(input) {
    const o = input || {};
    const seed = String(o.seed || '');
    const limit = o.maxBytes || LIMITS.homeroom;
    const parts = [];
    const traits = [];
    const usedGroups = new Set();
    (o.traits || []).forEach(t => {
      if (!TRAIT_SENTENCES[t]) return;
      const g = TRAIT_GROUP[t] || t;
      if (usedGroups.has(g)) return;
      usedGroups.add(g);
      traits.push(t);
    });
    traits.forEach((t, i) => {
      parts.push({
        role: 'trait', prio: i < 2 ? 1 : 3,
        text: pick(CONNECTORS, seed + 'T' + i) + pick(TRAIT_SENTENCES[t], seed + 'TS' + t) + '.'
      });
    });
    parts.push(...evidenceParts(o.evidence, seed, 2));
    if (o.growth) {
      parts.push({ role: 'growth', prio: 4, text: pick(HOMEROOM_GROWTH, seed + 'G') + '.' });
    }
    parts.push({ role: 'closing', prio: 5, text: pick(HOMEROOM_CLOSING, seed + 'C') + '.' });
    return finish(parts, limit, Object.assign({}, o, { context: 'homeroom' }));
  }

  // rows: [{ id, evidence: [], tags: [] }]  (homeroom이면 tags는 행동특성)
  function composeBatch(mode, rows, common) {
    const c = common || {};
    const items = (rows || []).map(row => {
      const base = { evidence: row.evidence || [], tags: row.tags || [], seed: row.id, schoolNames: c.schoolNames };
      const r = mode === 'homeroom'
        ? composeHomeroom(Object.assign({}, base, { traits: row.tags || [], growth: c.growth }))
        : composeSubjectNote(Object.assign({}, base, {
            profile: c.profile, level: row.level || c.level, keywords: c.keywords || [],
            aptitude: c.aptitude, hasGrowth: c.hasGrowth
          }));
      return { id: row.id, text: r.text, bytes: r.bytes, limit: r.limit, dropped: r.dropped, warnings: r.warnings };
    });
    const seen = new Map();
    (rows || []).forEach(row => {
      (row.evidence || []).map(e => String(e).trim()).filter(Boolean).forEach(e => {
        if (!seen.has(e)) seen.set(e, []);
        seen.get(e).push(row.id);
      });
    });
    const sameEvidence = [];
    seen.forEach((ids, text) => {
      if (ids.length > 1) sameEvidence.push({ text, ids });
    });
    return {
      items,
      pairs: findSimilar(items, c.threshold || DUPLICATE_THRESHOLD),
      sameEvidence
    };
  }

  // 성취기준 문장에서 핵심 키워드 후보를 뽑는다(교사가 확인·수정하는 것을 전제로 한 추천).
  function suggestKeywords(standardsText, max) {
    const words = String(standardsText || '')
      .split(/[\s,.·()\[\]'"“”‘’:;]+/)
      .map(w => w.replace(JOSA_SUFFIX, ''))
      .filter(w => w.length >= 2 && /[가-힣]/.test(w) && !KEYWORD_STOP.has(w) && !VERB_END.test(w));
    const out = [];
    words.forEach(w => { if (!out.includes(w) && out.length < (max || 5)) out.push(w); });
    return out;
  }

  // 평가계획(PDF에서 읽은 글)에서 과목 기본 자료를 뽑는다. 결과는 교사가 확인한 뒤에만 저장된다.
  //  과목명: "(철도신호제어시공)교과 …" 제목, 또는 "과목명: 정보"
  //  능력단위: "능력단위: 가, 나" 줄, 없으면 "이름 (1901100210_14v1)" 같은 능력단위 코드 줄
  //  성취기준: "[12정보01-01]" 코드 줄, 없으면 수행평가 세부 계획의 "성취기준" 칸(있다.로 끝나는 문장만)
  //  성취수준: "학기 단위 성취수준" 표의 A~E(글자 줄은 빼고 문장 단위로 나눠 A~E 순서로 넣는다), 없으면 "A: 내용" 형식
  function parsePlanText(text) {
    const t = String(text || '').replace(/\r/g, '');
    const out = { subject: '', kind: 'general', standards: [], standardsText: '', levels: {}, levelNote: '', keywords: [], units: [] };
    const tm = t.match(/\(([가-힣·]{2,20})\)\s*교과/) || t.match(/과목명?\s*[:：]\s*([가-힣A-Za-z·]{2,20})/);
    if (tm) out.subject = tm[1];
    if (/능력단위/.test(t)) out.kind = 'practical';
    let m;

    // PDF 줄바꿈: 한글 사이에서 끊긴 줄은 공백 없이 잇고, 나머지는 공백으로 잇는다
    const joinLines = arr => {
      let s = '';
      arr.forEach(l => {
        if (!l) return;
        if (!s) s = l;
        else if (/[가-힣]$/.test(s) && /^[가-힣]/.test(l)) s += l;
        else s += ' ' + l;
      });
      return s.replace(/\s+/g, ' ').trim();
    };

    // 성취기준 — 코드가 있는 형식
    const seen = new Set();
    const sre = /\[?(\d{1,2}[가-힣A-Za-z]{1,8}\d{2}-\d{2})\]?\s*([^\n[]{4,200})/g;
    while ((m = sre.exec(t))) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.standards.push({ code: m[1], text: m[2].replace(/\s+/g, ' ').trim() });
    }
    // 성취기준 — 수행평가 세부 계획의 "성취기준" 칸(코드 없는 형식). 평가요소 항목(□, ✔)은 칸에 섞여 있어 그 앞에서 자른다.
    const stdSeen = new Set(out.standards.map(s => s.text));
    const bre = /(?:^|\n)[ \t]*성취기준(?![ \t]*및)[ \t]*\n?([\s\S]*?)(?=\s*(?:평가요소|평가 요소|평가방법|평가시기|□|✔|(?<![가-힣A-Za-z])o\s))/g;
    while ((m = bre.exec(t))) {
      const body = m[1];
      if (body.length > 800 || /수업방법/.test(body)) continue;
      // ▣가 있으면 첫 ▣ 앞의 글은 같은 칸의 다른 열 조각이라 버린다
      const pieces = body.indexOf('▣') >= 0 ? body.split('▣').slice(1) : [body];
      pieces.forEach(piece => {
        const s = joinLines(piece.split('\n').map(x => x.trim()));
        if (s.length >= 10 && /있다\.?$/.test(s) && !stdSeen.has(s)) {
          stdSeen.add(s);
          out.standards.push({ code: '', text: s });
        }
      });
    }
    out.standardsText = out.standards.map(s => (s.code ? '[' + s.code + '] ' : '- ') + s.text).join('\n');
    if (out.standards.length) out.keywords = suggestKeywords(out.standards.map(s => s.text).join(' '), 6);

    // 능력단위 — 코드(1901100210_14v1)가 붙은 줄의 이름. 같은 코드는 한 번만 쓴다. 세부 단위(.1 등)는 제외.
    const lines = t.split('\n').map(s => s.trim());
    const codeOnly = /^\(?\s*(?:LM)?(\d{10}_\d+v\d+)\s*\)?$/;
    const nameAndCode = /^(.+?)\s*\(\s*(?:LM)?(\d{10}_\d+v\d+)\s*\)$/;
    const labelRe = /^(내용영역|능력단위|내용영역요소|평가|교육과정|시기|학년|학기|영역$)/;
    const codes = new Set();
    const found = [];
    lines.forEach((ln, i) => {
      let name = '', code = '';
      const a = ln.match(nameAndCode);
      if (a) { name = a[1]; code = a[2]; }
      else {
        const c = ln.match(codeOnly);
        if (c && i > 0) { name = lines[i - 1]; code = c[1]; }
      }
      if (!code || codes.has(code)) return;
      name = name.replace(/^\(?능력단위\)?\s*/, '').replace(/^\d{1,2}\s+\d-\d\s*/, '').trim();
      if (name.length < 3 || !/[가-힣]/.test(name) || name.length > 30 || labelRe.test(name)) return;
      codes.add(code);
      found.push(name);
    });
    const um = t.match(/능력단위\s*[:：]\s*([^\n]{2,80})/);
    out.units = um ? um[1].split(/[,，]/).map(s => s.trim()).filter(Boolean) : found;

    // 성취수준 — "학기 단위 성취수준" 표. 글자 줄(A~E)은 칸 가운데에 있어 위치로 나눌 수 없으므로,
    // 글자를 빼고 이어 붙인 뒤 문장 단위로 나눠 다섯 문장이면 A~E 순서로 넣는다.
    const lvAt = t.indexOf('학기 단위 성취수준');
    if (lvAt >= 0) {
      const body = [];
      let stop = false;
      t.slice(lvAt).split('\n').slice(1).forEach(raw => {
        if (stop) return;
        const line = raw.trim();
        if (!line) return;
        if (/^\(고\)\s*최소/.test(line) || /^\d{1,2}\.\s/.test(line)) { stop = true; return; }
        if (/성취수준/.test(line) && line.length < 20) return;
        body.push(line.replace(/^[A-E](\s+|$)/, ''));
      });
      // 마침표로 끝난 문장만 쓴다. 표 끝의 조각(마침표 없음)은 다음 행의 일부라 버린다.
      const sentences = joinLines(body).split(/(?<=\.)\s+/).filter(s => /\.$/.test(s));
      if (sentences.length === 5) {
        ['A', 'B', 'C', 'D', 'E'].forEach((k, i) => { out.levels[k] = sentences[i]; });
      } else if (sentences.length) {
        out.levelNote = '학기 단위 성취수준 문장을 ' + sentences.length + '개로 나누었습니다(A~E는 5개여야 함). 칸을 직접 확인해 주세요.';
      }
    }
    // 성취수준 — "A: 내용" 형식(위 표가 없을 때)
    if (!Object.keys(out.levels).length) {
      const at = t.indexOf('성취수준');
      const scope = at >= 0 ? t.slice(at) : t;
      const lre = /(?:^|[\s|·])([A-E])\s*(?:\([^)\n]{0,20}\))?\s*[:：]\s*([가-힣][^\n]*?)(?=\s+[A-E]\s*(?:\([^)\n]{0,20}\))?\s*[:：]|\n|$)/g;
      while ((m = lre.exec(scope))) {
        if (!out.levels[m[1]]) out.levels[m[1]] = m[2].replace(/\s+/g, ' ').trim();
      }
    }
    return out;
  }

  // 프로필 저장 전 검사: 과목명과 최소 한 개의 자료가 있어야 한다.
  function validateProfile(p) {
    const errs = [];
    if (!p || !String(p.subject || '').trim()) errs.push('과목명을 입력해 주세요.');
    if (p && p.levels) {
      Object.keys(p.levels).forEach(k => {
        const t = p.levels[k];
        if (t && !LEVEL_SENTENCES[k]) errs.push('성취수준 ' + k + '는 A~E만 사용할 수 있습니다.');
        if (t && checkText(t).some(w => w.level === 'error')) errs.push('성취수준 ' + k + ' 기술에 기재 불가 내용이 있습니다.');
      });
    }
    return errs;
  }

  function bigramCounts(s) {
    const t = String(s).replace(/\s+/g, '');
    const m = new Map();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.substr(i, 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  }

  function similarity(a, b) {
    const A = bigramCounts(a);
    const B = bigramCounts(b);
    let inter = 0, na = 0, nb = 0;
    A.forEach((v, k) => { na += v; if (B.has(k)) inter += Math.min(v, B.get(k)); });
    B.forEach(v => { nb += v; });
    return na + nb ? (2 * inter) / (na + nb) : 0;
  }

  function findSimilar(items, threshold) {
    const th = threshold || DUPLICATE_THRESHOLD;
    const pairs = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const s = similarity(items[i].text, items[j].text);
        if (s >= th) pairs.push({ a: items[i].id, b: items[j].id, score: Math.round(s * 100) / 100 });
      }
    }
    return pairs;
  }

  return {
    LIMITS,
    DUPLICATE_THRESHOLD,
    byteLen,
    josa,
    toNominal,
    checkText,
    composeSubjectNote,
    composeHomeroom,
    composeBatch,
    suggestKeywords,
    parsePlanText,
    validateProfile,
    similarity,
    findSimilar,
    CONFIRM_ITEMS
  };
});
