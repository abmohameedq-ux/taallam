'use strict';
// Simulation templates: the PHYSICS/GEOMETRY lives here and nowhere else.
// Every number a student sees is produced by compute() from the parameters through the real
// equations (no random motion, no canned values). This file has no DOM code, so the same file runs
// in the browser (SIM.mount draws it) and in Node (the server validates parameters, and the tests
// check the results against independent calculations and conservation laws).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.SIMT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PI = Math.PI, rad = d => d * PI / 180, r2 = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;
  const out = (k, label, value, unit, formula) => ({ k, label, value: r2(value), unit: unit || '', formula: formula || '' });
  const P = (k, label, unit, min, max, step, def, extra) => ({ k, label, unit, min, max, step, def, ...(extra || {}) });
  const G_CHOICES = [{ v: 9.8, t: 'الأرض 9.8' }, { v: 1.62, t: 'القمر 1.62' }, { v: 3.71, t: 'المريخ 3.71' }, { v: 24.8, t: 'المشتري 24.8' }];

  const TEMPLATES = {
    // ------------------------------------------------------------------ free fall
    free_fall: {
      id: 'free_fall', title: 'السقوط الحر', subject: 'الفيزياء', kind: 'motion',
      intro: 'اترك جسمًا يسقط من ارتفاع، وغيّر الارتفاع والجاذبية والسرعة الابتدائية وشاهد الزمن والسرعة.',
      params: [P('h', 'الارتفاع', 'م', 1, 500, 1, 20), P('g', 'تسارع الجاذبية', 'م/ث²', 1, 30, 0.01, 9.8, { choices: G_CHOICES }), P('v0', 'السرعة الابتدائية للأسفل', 'م/ث', 0, 50, 0.5, 0)],
      compute(p) {
        const t = (-p.v0 + Math.sqrt(p.v0 * p.v0 + 2 * p.g * p.h)) / p.g, v = p.v0 + p.g * t;
        return {
          duration: t,
          outputs: [out('t', 'زمن السقوط', t, 'ث', 't = (−v₀ + √(v₀² + 2gh)) / g'), out('v', 'سرعة الاصطدام بالأرض', v, 'م/ث', 'v = v₀ + g·t'), out('ke', 'الطاقة الحركية لكل كغ', v * v / 2, 'جول/كغ', 'KE/m = v²/2')],
          at(tt) { const x = Math.min(tt, t); return { y: p.h - (p.v0 * x + 0.5 * p.g * x * x), v: p.v0 + p.g * x, t: x }; },
          notes: ['الكتلة لا تؤثر في زمن السقوط (بإهمال مقاومة الهواء).']
        };
      },
      selfCheck() {
        const c = TEMPLATES.free_fall, a = c.compute({ h: 20, g: 9.8, v0: 0 }), b = c.compute({ h: 80, g: 9.8, v0: 0 });
        const d = c.compute({ h: 45, g: 9.8, v0: 5 }), end = d.at(d.duration);
        return [
          { name: 'زمن السقوط من 20م = √(2h/g)', ok: Math.abs(a.outputs[0].value - Math.sqrt(2 * 20 / 9.8)) < 1e-3 },
          { name: 'مضاعفة الارتفاع أربع مرات تضاعف الزمن', ok: Math.abs(b.outputs[0].value / a.outputs[0].value - 2) < 1e-2 },
          { name: 'الجسم يصل الأرض عند نهاية الزمن (y = 0)', ok: Math.abs(end.y) < 1e-6 },
          { name: 'حفظ الطاقة: ½v² = ½v₀² + g·h', ok: Math.abs(d.outputs[1].value ** 2 / 2 - (25 / 2 + 9.8 * 45)) < 0.05 }
        ];
      }
    },
    // ------------------------------------------------------------------ projectile
    projectile: {
      id: 'projectile', title: 'حركة المقذوفات', subject: 'الفيزياء', kind: 'motion',
      intro: 'اقذف جسمًا بزاوية وسرعة، وشاهد مساره والمدى وأقصى ارتفاع وزمن الطيران.',
      params: [P('v0', 'سرعة القذف', 'م/ث', 1, 80, 0.5, 25), P('ang', 'زاوية القذف', '°', 5, 85, 1, 45), P('h0', 'ارتفاع نقطة القذف', 'م', 0, 100, 1, 0), P('g', 'تسارع الجاذبية', 'م/ث²', 1, 30, 0.01, 9.8, { choices: G_CHOICES })],
      compute(p) {
        const vx = p.v0 * Math.cos(rad(p.ang)), vy = p.v0 * Math.sin(rad(p.ang));
        const t = (vy + Math.sqrt(vy * vy + 2 * p.g * p.h0)) / p.g, range = vx * t, hmax = p.h0 + vy * vy / (2 * p.g);
        return {
          duration: t,
          outputs: [out('t', 'زمن الطيران', t, 'ث', 't = (v₀ᵧ + √(v₀ᵧ² + 2g·h₀)) / g'), out('range', 'المدى الأفقي', range, 'م', 'R = v₀ₓ · t'), out('hmax', 'أقصى ارتفاع', hmax, 'م', 'H = h₀ + v₀ᵧ² / 2g'), out('vx', 'المركبة الأفقية للسرعة', vx, 'م/ث', 'v₀ₓ = v₀ cos θ'), out('vy', 'المركبة الرأسية الابتدائية', vy, 'م/ث', 'v₀ᵧ = v₀ sin θ')],
          at(tt) { const x = Math.min(tt, t); return { x: vx * x, y: p.h0 + vy * x - 0.5 * p.g * x * x, t: x, vx, vy: vy - p.g * x }; },
          bounds: { w: range, h: hmax },
          notes: ['المركبة الأفقية ثابتة، والرأسية تتغير بتأثير الجاذبية فقط (بإهمال مقاومة الهواء).']
        };
      },
      selfCheck() {
        const c = TEMPLATES.projectile, a = c.compute({ v0: 20, ang: 45, h0: 0, g: 9.8 }), b = c.compute({ v0: 20, ang: 30, h0: 0, g: 9.8 }), d = c.compute({ v0: 20, ang: 60, h0: 0, g: 9.8 });
        const e = c.compute({ v0: 15, ang: 40, h0: 12, g: 9.8 }), end = e.at(e.duration);
        return [
          { name: 'المدى عند 45° = v₀²/g (من نفس الارتفاع)', ok: Math.abs(a.outputs[1].value - 400 / 9.8) < 1e-2 },
          { name: 'الزاويتان المتتامتان (30° و60°) لهما المدى نفسه', ok: Math.abs(b.outputs[1].value - d.outputs[1].value) < 1e-2 },
          { name: 'المقذوف يهبط إلى y = 0 عند نهاية الزمن', ok: Math.abs(end.y) < 1e-6 },
          { name: 'أقصى ارتفاع عند 90° تقريبًا = v₀²/2g', ok: Math.abs(c.compute({ v0: 20, ang: 85, h0: 0, g: 9.8 }).outputs[2].value - (20 * Math.sin(rad(85))) ** 2 / 19.6) < 1e-2 }
        ];
      }
    },
    // ------------------------------------------------------------------ 1-D collision
    collision_1d: {
      id: 'collision_1d', title: 'التصادم والزخم', subject: 'الفيزياء', kind: 'motion',
      intro: 'اصطدم عربتان على خط مستقيم. غيّر الكتل والسرعات ومعامل الارتداد وراقب الزخم والطاقة قبل التصادم وبعده.',
      params: [P('m1', 'كتلة العربة الأولى', 'كغ', 0.5, 20, 0.5, 2), P('v1', 'سرعة الأولى', 'م/ث', -10, 10, 0.5, 4), P('m2', 'كتلة العربة الثانية', 'كغ', 0.5, 20, 0.5, 3), P('v2', 'سرعة الثانية', 'م/ث', -10, 10, 0.5, -1),
        P('e', 'معامل الارتداد', '', 0, 1, 0.05, 1, { help: '1 = مرن تمامًا، 0 = عديم المرونة (يلتصقان)' })],
      compute(p) {
        const M = p.m1 + p.m2, collides = p.v1 > p.v2;
        const u1 = collides ? ((p.m1 - p.e * p.m2) * p.v1 + (1 + p.e) * p.m2 * p.v2) / M : p.v1, u2 = collides ? ((p.m2 - p.e * p.m1) * p.v2 + (1 + p.e) * p.m1 * p.v1) / M : p.v2;
        const pb = p.m1 * p.v1 + p.m2 * p.v2, pa = p.m1 * u1 + p.m2 * u2, kb = 0.5 * p.m1 * p.v1 ** 2 + 0.5 * p.m2 * p.v2 ** 2, ka = 0.5 * p.m1 * u1 ** 2 + 0.5 * p.m2 * u2 ** 2;
        return {
          collides, duration: 6,
          outputs: [out('u1', 'سرعة الأولى بعد التصادم', u1, 'م/ث', "v₁' = ((m₁ − e·m₂)v₁ + (1+e)·m₂·v₂) / (m₁+m₂)"), out('u2', 'سرعة الثانية بعد التصادم', u2, 'م/ث', "v₂' = ((m₂ − e·m₁)v₂ + (1+e)·m₁·v₁) / (m₁+m₂)"),
            out('pb', 'الزخم الكلي قبل', pb, 'كغ·م/ث', 'p = m₁v₁ + m₂v₂'), out('pa', 'الزخم الكلي بعد', pa, 'كغ·م/ث', "p' = m₁v₁' + m₂v₂'"),
            out('kb', 'الطاقة الحركية قبل', kb, 'جول', 'KE = ½mv²'), out('ka', 'الطاقة الحركية بعد', ka, 'جول', ''), out('loss', 'الطاقة المفقودة', kb - ka, 'جول', 'تتحول إلى حرارة وتشوّه')],
          state(tt) { // positions on a line, collision happens when x1 reaches x2 (starting 8 m apart)
            const gap = 8, tc = collides ? gap / (p.v1 - p.v2) : Infinity;
            if (tt < tc) return { x1: p.v1 * tt, x2: gap + p.v2 * tt, hit: false };
            const xc1 = p.v1 * tc, xc2 = gap + p.v2 * tc; return { x1: xc1 + u1 * (tt - tc), x2: xc2 + u2 * (tt - tc), hit: true, tc };
          },
          notes: collides ? ['الزخم الكلي محفوظ دائمًا. الطاقة الحركية تُحفظ فقط في التصادم المرن (e = 1).'] : ['العربتان لا تتقاربان (السرعة الأولى ليست أكبر من الثانية)، فلا يحدث تصادم.']
        };
      },
      selfCheck() {
        const c = TEMPLATES.collision_1d, el = c.compute({ m1: 2, v1: 4, m2: 3, v2: -1, e: 1 }), ine = c.compute({ m1: 2, v1: 4, m2: 3, v2: -1, e: 0 }), eq = c.compute({ m1: 5, v1: 3, m2: 5, v2: 0, e: 1 });
        return [
          { name: 'حفظ الزخم (مرن)', ok: Math.abs(el.outputs[2].value - el.outputs[3].value) < 1e-3 },
          { name: 'حفظ الطاقة الحركية (مرن)', ok: Math.abs(el.outputs[4].value - el.outputs[5].value) < 1e-2 },
          { name: 'عديم المرونة: العربتان تتحركان معًا بسرعة (m₁v₁+m₂v₂)/(m₁+m₂)', ok: Math.abs(ine.outputs[0].value - ine.outputs[1].value) < 1e-3 && Math.abs(ine.outputs[0].value - (8 - 3) / 5) < 1e-3 },
          { name: 'كتلتان متساويتان مرنتان تتبادلان السرعتين', ok: Math.abs(eq.outputs[0].value) < 1e-3 && Math.abs(eq.outputs[1].value - 3) < 1e-3 },
          { name: 'الطاقة لا تزيد بعد التصادم', ok: ine.outputs[6].value >= -1e-6 }
        ];
      }
    },
    // ------------------------------------------------------------------ force and friction
    force_friction: {
      id: 'force_friction', title: 'القوة والاحتكاك', subject: 'الفيزياء', kind: 'motion',
      intro: 'اسحب صندوقًا على سطح أفقي بقوة. غيّر الكتلة والقوة ومعاملات الاحتكاك وانظر متى يبدأ بالحركة وكم تكون عجلته.',
      params: [P('m', 'الكتلة', 'كغ', 1, 100, 1, 10), P('F', 'القوة الأفقية المؤثرة', 'نيوتن', 0, 300, 1, 40), P('mus', 'معامل الاحتكاك الساكن', '', 0.05, 1.2, 0.01, 0.5), P('muk', 'معامل الاحتكاك الحركي', '', 0.05, 1.2, 0.01, 0.3)],
      compute(p) {
        const g = 9.8, N = p.m * g, fsMax = p.mus * N, fk = Math.min(p.muk, p.mus) * N, moves = p.F > fsMax;
        const a = moves ? (p.F - fk) / p.m : 0, f = moves ? fk : p.F;
        return {
          moves, duration: 5,
          outputs: [out('N', 'القوة العمودية', N, 'نيوتن', 'N = m·g'), out('fsmax', 'أكبر احتكاك ساكن', fsMax, 'نيوتن', 'f_s(max) = μ_s·N'), out('f', moves ? 'قوة الاحتكاك الحركي' : 'قوة الاحتكاك المؤثرة', f, 'نيوتن', moves ? 'f_k = μ_k·N' : 'f = F (الجسم ساكن)'),
            out('net', 'القوة المحصلة', moves ? p.F - fk : 0, 'نيوتن', 'ΣF = F − f'), out('a', 'التسارع', a, 'م/ث²', 'a = ΣF / m')],
          at(tt) { return { x: 0.5 * a * tt * tt, v: a * tt }; },
          notes: [moves ? 'القوة أكبر من أكبر احتكاك ساكن، فيتحرك الصندوق بتسارع ثابت.' : 'القوة لا تتجاوز أكبر احتكاك ساكن، فيبقى الصندوق ساكنًا والاحتكاك يساوي القوة.', 'يُفترض أن μ_k لا يزيد على μ_s.']
        };
      },
      selfCheck() {
        const c = TEMPLATES.force_friction, a = c.compute({ m: 10, F: 40, mus: 0.5, muk: 0.3 }), b = c.compute({ m: 10, F: 60, mus: 0.5, muk: 0.3 }), z = c.compute({ m: 10, F: 0, mus: 0.5, muk: 0.3 });
        return [
          { name: 'قوة أقل من الاحتكاك الساكن: لا حركة (a = 0)', ok: a.outputs[4].value === 0 && a.moves === false },
          { name: 'a = (F − μ_k·m·g)/m عند الحركة', ok: Math.abs(b.outputs[4].value - (60 - 0.3 * 98) / 10) < 1e-3 },
          { name: 'القوة العمودية = m·g', ok: Math.abs(a.outputs[0].value - 98) < 1e-6 },
          { name: 'بلا قوة لا احتكاك', ok: z.outputs[2].value === 0 }
        ];
      }
    },
    // ------------------------------------------------------------------ 2-D area
    geometry_area: {
      id: 'geometry_area', title: 'المساحة والمحيط', subject: 'الرياضيات', kind: 'geometry',
      intro: 'غيّر أبعاد الشكل وشاهد المساحة والمحيط يتغيران مباشرة وفق القوانين.',
      params: [P('shape', 'الشكل', '', 0, 4, 1, 0, { choices: [{ v: 0, t: 'مستطيل' }, { v: 1, t: 'مثلث' }, { v: 2, t: 'دائرة' }, { v: 3, t: 'شبه منحرف' }, { v: 4, t: 'متوازي أضلاع' }] }),
        P('a', 'البعد الأول (الطول / القاعدة / نصف القطر)', 'سم', 1, 30, 0.5, 8), P('b', 'البعد الثاني (العرض / الارتفاع / القاعدة الثانية)', 'سم', 1, 30, 0.5, 5), P('h', 'الارتفاع (لشبه المنحرف)', 'سم', 1, 30, 0.5, 4)],
      compute(p) {
        const s = Math.round(p.shape), a = p.a, b = p.b, h = p.h; let area, per = null, af, pf, name;
        if (s === 0) { name = 'مستطيل'; area = a * b; per = 2 * (a + b); af = 'المساحة = الطول × العرض'; pf = 'المحيط = 2 × (الطول + العرض)'; }
        else if (s === 1) { name = 'مثلث'; area = 0.5 * a * b; af = 'المساحة = ½ × القاعدة × الارتفاع'; }
        else if (s === 2) { name = 'دائرة'; area = PI * a * a; per = 2 * PI * a; af = 'المساحة = π × نق²'; pf = 'المحيط = 2 × π × نق'; }
        else if (s === 3) { name = 'شبه منحرف'; area = 0.5 * (a + b) * h; af = 'المساحة = ½ × (القاعدة الأولى + الثانية) × الارتفاع'; }
        else { name = 'متوازي أضلاع'; area = a * b; af = 'المساحة = القاعدة × الارتفاع'; }
        const outputs = [out('area', 'مساحة ال' + name, area, 'سم²', af)]; if (per !== null) outputs.push(out('per', s === 2 ? 'محيط الدائرة' : 'المحيط', per, 'سم', pf));
        return { shape: s, name, outputs, notes: s === 1 || s === 3 || s === 4 ? ['المحيط يحتاج أطوال الأضلاع المائلة، لذلك تُعرض المساحة فقط.'] : [] };
      },
      selfCheck() {
        const c = TEMPLATES.geometry_area, v = (s, a, b, h) => c.compute({ shape: s, a, b, h }).outputs;
        return [
          { name: 'مستطيل 8×5: المساحة 40 والمحيط 26', ok: v(0, 8, 5, 4)[0].value === 40 && v(0, 8, 5, 4)[1].value === 26 },
          { name: 'مثلث قاعدته 6 وارتفاعه 4: المساحة 12', ok: v(1, 6, 4, 4)[0].value === 12 },
          { name: 'دائرة نق 7: المساحة 153.938 والمحيط 43.982', ok: Math.abs(v(2, 7, 1, 1)[0].value - 153.938) < 1e-3 && Math.abs(v(2, 7, 1, 1)[1].value - 43.982) < 1e-3 },
          { name: 'شبه منحرف (6 و10 وارتفاع 4): المساحة 32', ok: v(3, 6, 10, 4)[0].value === 32 },
          { name: 'المساحة تتناسب طرديًا مع الطول', ok: Math.abs(v(0, 16, 5, 4)[0].value / v(0, 8, 5, 4)[0].value - 2) < 1e-9 }
        ];
      }
    },
    // ------------------------------------------------------------------ solids
    solid_volume: {
      id: 'solid_volume', title: 'المجسمات: الحجم والمساحة السطحية', subject: 'الرياضيات', kind: 'solid',
      intro: 'أدِر المجسم بالسحب، وغيّر أبعاده، وشاهد الحجم والمساحة الكلية تُحسبان من القوانين.',
      params: [P('solid', 'المجسم', '', 0, 5, 1, 0, { choices: [{ v: 0, t: 'مكعب' }, { v: 1, t: 'متوازي مستطيلات' }, { v: 2, t: 'أسطوانة' }, { v: 3, t: 'مخروط' }, { v: 4, t: 'كرة' }, { v: 5, t: 'هرم رباعي' }] }),
        P('a', 'الطول / نصف القطر / ضلع القاعدة', 'سم', 1, 20, 0.5, 6), P('b', 'العرض', 'سم', 1, 20, 0.5, 4), P('h', 'الارتفاع', 'سم', 1, 20, 0.5, 8)],
      compute(p) {
        const s = Math.round(p.solid), a = p.a, b = p.b, h = p.h; let V, S, name, vf, sf, extra = [];
        if (s === 0) { name = 'مكعب'; V = a ** 3; S = 6 * a * a; vf = 'الحجم = الضلع³'; sf = 'المساحة الكلية = 6 × الضلع²'; }
        else if (s === 1) { name = 'متوازي مستطيلات'; V = a * b * h; S = 2 * (a * b + b * h + a * h); vf = 'الحجم = الطول × العرض × الارتفاع'; sf = 'المساحة الكلية = 2(ل·ع + ع·ف + ل·ف)'; }
        else if (s === 2) { name = 'أسطوانة'; V = PI * a * a * h; S = 2 * PI * a * (a + h); vf = 'الحجم = π × نق² × ع'; sf = 'المساحة الكلية = 2π·نق·(نق + ع)'; }
        else if (s === 3) { const l = Math.sqrt(a * a + h * h); name = 'مخروط'; V = PI * a * a * h / 3; S = PI * a * (a + l); vf = 'الحجم = ⅓ × π × نق² × ع'; sf = 'المساحة الكلية = π·نق·(نق + الارتفاع المائل)'; extra = [out('l', 'الارتفاع المائل', l, 'سم', 'ل = √(نق² + ع²)')]; }
        else if (s === 4) { name = 'كرة'; V = 4 / 3 * PI * a ** 3; S = 4 * PI * a * a; vf = 'الحجم = ⁴⁄₃ × π × نق³'; sf = 'المساحة = 4π·نق²'; }
        else { const l = Math.sqrt(h * h + (a / 2) ** 2); name = 'هرم رباعي'; V = a * a * h / 3; S = a * a + 2 * a * l; vf = 'الحجم = ⅓ × مساحة القاعدة × الارتفاع'; sf = 'المساحة الكلية = القاعدة + 4 × (½ × الضلع × الارتفاع الجانبي)'; extra = [out('l', 'الارتفاع الجانبي للوجه', l, 'سم', 'ل = √(ع² + (ض/2)²)')]; }
        return { solid: s, name, outputs: [out('V', 'حجم ال' + name, V, 'سم³', vf), out('S', 'المساحة الكلية', S, 'سم²', sf), ...extra], notes: s === 1 || s === 0 ? [] : [] };
      },
      selfCheck() {
        const c = TEMPLATES.solid_volume, v = (s, a, b, h) => c.compute({ solid: s, a, b, h }).outputs;
        return [
          { name: 'مكعب ضلعه 3: الحجم 27 والمساحة 54', ok: v(0, 3, 1, 1)[0].value === 27 && v(0, 3, 1, 1)[1].value === 54 },
          { name: 'متوازي 2×3×4: الحجم 24 والمساحة 52', ok: v(1, 2, 3, 4)[0].value === 24 && v(1, 2, 3, 4)[1].value === 52 },
          { name: 'أسطوانة نق 3 وع 5: الحجم 141.372', ok: Math.abs(v(2, 3, 1, 5)[0].value - 141.372) < 1e-3 },
          { name: 'حجم المخروط = ثلث حجم الأسطوانة المماثلة', ok: Math.abs(v(3, 3, 1, 5)[0].value * 3 - v(2, 3, 1, 5)[0].value) < 1e-2 },
          { name: 'كرة نق 3: الحجم 113.097 والمساحة 113.097', ok: Math.abs(v(4, 3, 1, 1)[0].value - 113.097) < 1e-3 && Math.abs(v(4, 3, 1, 1)[1].value - 113.097) < 1e-3 },
          { name: 'هرم قاعدته 6 وارتفاعه 4: الحجم 48', ok: v(5, 6, 1, 4)[0].value === 48 }
        ];
      }
    }
  };

  // keywords used to suggest a template for a page of a book (Arabic + English); matched after Arabic normalisation
  const KEYWORDS = {
    free_fall: ['السقوط الحر', 'سقوط حر', 'تسارع الجاذبية', 'الجاذبية الارضية', 'free fall', 'acceleration due to gravity'],
    projectile: ['المقذوف', 'المقذوفات', 'القذيفة', 'زاوية القذف', 'زاوية الاطلاق', 'projectile'],
    collision_1d: ['التصادم', 'تصادم', 'كمية التحرك', 'الزخم', 'اصطدام', 'collision', 'momentum'],
    force_friction: ['قوة الاحتكاك', 'الاحتكاك', 'قانون نيوتن الثاني', 'القوة المحصلة', 'friction', "newton's second"],
    geometry_area: ['مساحة المستطيل', 'مساحة المثلث', 'مساحة الدائرة', 'مساحة شبه المنحرف', 'محيط الدائرة', 'محيط المستطيل', 'area of', 'perimeter', 'area of a circle', 'area of a triangle', 'area of a rectangle', 'area of a trapezoid'],
    solid_volume: ['حجم المكعب', 'حجم الاسطوانة', 'حجم المخروط', 'حجم الكرة', 'حجم الهرم', 'المساحة الكلية للمجسم', 'volume of', 'surface area', 'volume of a cube', 'volume of a cylinder', 'volume of a cone', 'volume of a sphere', 'volume of a pyramid']
  };

  function defaults(id) { const t = TEMPLATES[id]; return Object.fromEntries(t.params.map(p => [p.k, p.def])); }
  // returns { ok, params, error } — numbers are clamped to the template's range, unknown keys dropped
  function validate(id, params) {
    const t = TEMPLATES[id]; if (!t) return { ok: false, error: 'نوع التجربة غير معروف.' };
    const out2 = {}, src = params && typeof params === 'object' ? params : {};
    for (const p of t.params) {
      let v = src[p.k] === undefined ? p.def : Number(src[p.k]);
      if (!Number.isFinite(v)) return { ok: false, error: 'قيمة غير صالحة للمتغير «' + p.label + '».' };
      v = Math.min(p.max, Math.max(p.min, v)); out2[p.k] = v;
    }
    if (id === 'force_friction' && out2.muk > out2.mus) out2.muk = out2.mus;
    return { ok: true, params: out2 };
  }
  function selfCheckAll(id) {
    const t = TEMPLATES[id]; if (!t) return [{ name: 'نوع التجربة معروف', ok: false }];
    const checks = t.selfCheck(), res = t.compute(defaults(id));
    checks.push({ name: 'كل النتائج أعداد منتهية', ok: res.outputs.every(o => Number.isFinite(o.value)) });
    return checks;
  }
  return { TEMPLATES, KEYWORDS, defaults, validate, selfCheckAll, ids: Object.keys(TEMPLATES) };
});
