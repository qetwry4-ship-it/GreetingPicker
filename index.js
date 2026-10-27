// Greeting Picker — вставка первого/альтернативных приветствий карточки в текущий чат.
// Использует только SillyTavern.getContext(), поэтому не зависит от папки установки.

const MODULE = 'greeting_picker';
const DEFAULTS = {
    mode: 'add',      // 'add' — новым сообщением, 'replace' — заменить последнее сообщение бота
    asSwipes: true,   // положить все приветствия в свайпы вставленного сообщения
};

const ctx = () => SillyTavern.getContext();

function getSettings() {
    const c = ctx();
    if (!c.extensionSettings[MODULE]) c.extensionSettings[MODULE] = { ...DEFAULTS };
    const s = c.extensionSettings[MODULE];
    for (const k of Object.keys(DEFAULTS)) if (s[k] === undefined) s[k] = DEFAULTS[k];
    return s;
}

function saveSettings() {
    const c = ctx();
    if (typeof c.saveSettingsDebounced === 'function') c.saveSettingsDebounced();
}

function notify(type, text) {
    if (window.toastr && typeof window.toastr[type] === 'function') window.toastr[type](text, 'Greeting Picker');
    else console.log(`[Greeting Picker] ${text}`);
}

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Персонажи текущего чата (один — в обычном чате, участники — в групповом). */
function getCandidates() {
    const c = ctx();
    if (c.groupId) {
        const group = (c.groups || []).find(g => String(g.id) === String(c.groupId));
        if (!group) return [];
        return (group.members || [])
            .map(av => (c.characters || []).find(ch => ch.avatar === av))
            .filter(Boolean);
    }
    if (c.characterId === undefined || c.characterId === null) return [];
    const ch = c.characters?.[c.characterId];
    return ch ? [ch] : [];
}

/** Приветствия карточки. index: 0 — основное, 1..N — альтернативные (как в карточке). */
function getGreetings(ch) {
    const list = [];
    const first = ch.first_mes ?? ch.data?.first_mes ?? '';
    if (String(first).trim()) list.push({ index: 0, label: 'Основное приветствие', text: first });
    const alts = ch.data?.alternate_greetings ?? ch.alternate_greetings ?? [];
    alts.forEach((t, i) => {
        if (t && String(t).trim()) list.push({ index: i + 1, label: `Альтернативное №${i + 1}`, text: t });
    });
    return list;
}

async function removeLastMessage() {
    const c = ctx();
    if (typeof c.deleteLastMessage === 'function') {
        await c.deleteLastMessage();
        return;
    }
    // Запасной вариант для старых версий
    c.chat.pop();
    $('#chat .mes').last().remove();
}

/** Собственно вставка приветствия в чат. */
async function insertGreeting(ch, greetingIndex, opts) {
    const c = ctx();
    if (!Array.isArray(c.chat)) {
        notify('warning', 'Сначала откройте чат.');
        return false;
    }

    const greetings = getGreetings(ch);
    const pos = greetings.findIndex(g => g.index === greetingIndex);
    if (pos === -1) {
        notify('warning', `У персонажа ${ch.name} нет приветствия №${greetingIndex}.`);
        return false;
    }

    const sub = t => (typeof c.substituteParams === 'function' ? c.substituteParams(t, c.name1, ch.name) : t);
    const texts = greetings.map(g => sub(g.text));
    const date = new Date().toISOString();

    const msg = {
        name: ch.name,
        is_user: false,
        is_system: false,
        send_date: date,
        mes: texts[pos],
        extra: {},
    };

    if (c.groupId) {
        msg.original_avatar = ch.avatar;
        if (typeof c.getThumbnailUrl === 'function') msg.force_avatar = c.getThumbnailUrl('avatar', ch.avatar);
    }

    if (opts.asSwipes && texts.length > 1) {
        msg.swipes = [...texts];
        msg.swipe_id = pos;
        msg.swipe_info = texts.map(() => ({ send_date: date, gen_started: null, gen_finished: null, extra: {} }));
    }

    if (opts.mode === 'replace') {
        const last = c.chat[c.chat.length - 1];
        if (last && !last.is_user && !last.is_system) {
            await removeLastMessage();
        } else {
            notify('info', 'Последнее сообщение не от бота — приветствие добавлено новым сообщением.');
        }
    }

    c.chat.push(msg);
    const id = c.chat.length - 1;
    const ev = c.eventSource;
    const types = c.event_types || {};
    try { if (ev && types.MESSAGE_RECEIVED) await ev.emit(types.MESSAGE_RECEIVED, id, 'extension'); } catch (e) { console.warn(e); }
    c.addOneMessage(msg);
    try { if (ev && types.CHARACTER_MESSAGE_RENDERED) await ev.emit(types.CHARACTER_MESSAGE_RENDERED, id, 'extension'); } catch (e) { console.warn(e); }
    await c.saveChat();
    return true;
}

/* ---------------- Окно выбора ---------------- */

let overlay = null;

function closePicker() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.body.classList.remove('gp-open');
    document.removeEventListener('keydown', onKey);
}

function onKey(e) {
    if (e.key === 'Escape') closePicker();
}

function openPicker() {
    const candidates = getCandidates();
    if (!candidates.length) {
        notify('warning', 'Откройте чат с персонажем.');
        return;
    }
    closePicker();

    const s = getSettings();
    let current = candidates[0];

    overlay = document.createElement('div');
    overlay.className = 'gp-overlay';
    overlay.innerHTML = `
        <div class="gp-sheet" role="dialog" aria-modal="true" aria-label="Выбор приветствия">
            <div class="gp-grip"></div>
            <div class="gp-header">
                <div class="gp-title">Приветствия</div>
                <button type="button" class="gp-close" aria-label="Закрыть">✕</button>
            </div>
            ${candidates.length > 1 ? `
            <label class="gp-row gp-char">
                <span>Персонаж</span>
                <select class="gp-select text_pole">
                    ${candidates.map((ch, i) => `<option value="${i}">${esc(ch.name)}</option>`).join('')}
                </select>
            </label>` : ''}
            <div class="gp-options">
                <div class="gp-seg" role="radiogroup">
                    <button type="button" data-mode="add">Добавить новым</button>
                    <button type="button" data-mode="replace">Заменить последнее</button>
                </div>
                <label class="gp-check">
                    <input type="checkbox" class="gp-swipes" ${s.asSwipes ? 'checked' : ''}>
                    <span>Остальные приветствия — в свайпы</span>
                </label>
            </div>
            <div class="gp-list"></div>
        </div>`;

    document.body.appendChild(overlay);
    document.body.classList.add('gp-open');
    document.addEventListener('keydown', onKey);

    const list = overlay.querySelector('.gp-list');
    const segButtons = overlay.querySelectorAll('.gp-seg button');

    const paintMode = () => segButtons.forEach(b => b.classList.toggle('gp-active', b.dataset.mode === s.mode));
    paintMode();

    segButtons.forEach(b => b.addEventListener('click', () => {
        s.mode = b.dataset.mode;
        paintMode();
        saveSettings();
    }));

    overlay.querySelector('.gp-swipes').addEventListener('change', e => {
        s.asSwipes = e.target.checked;
        saveSettings();
    });

    overlay.querySelector('.gp-close').addEventListener('click', closePicker);
    overlay.addEventListener('click', e => { if (e.target === overlay) closePicker(); });

    const select = overlay.querySelector('.gp-select');
    if (select) select.addEventListener('change', () => {
        current = candidates[Number(select.value)];
        renderList();
    });

    function renderList() {
        const c = ctx();
        const greetings = getGreetings(current);
        if (!greetings.length) {
            list.innerHTML = '<div class="gp-empty">У этого персонажа нет приветствий в карточке.</div>';
            return;
        }
        const sub = t => (typeof c.substituteParams === 'function' ? c.substituteParams(t, c.name1, current.name) : t);
        list.innerHTML = greetings.map(g => `
            <div class="gp-card" data-index="${g.index}">
                <div class="gp-card-head">
                    <span class="gp-label">${esc(g.label)}</span>
                    <span class="gp-num">#${g.index}</span>
                </div>
                <div class="gp-text gp-clamp">${esc(sub(g.text))}</div>
                <div class="gp-actions">
                    <button type="button" class="gp-btn gp-expand">Развернуть</button>
                    <button type="button" class="gp-btn gp-insert">Вставить</button>
                </div>
            </div>`).join('');

        list.querySelectorAll('.gp-card').forEach(card => {
            const text = card.querySelector('.gp-text');
            const expand = card.querySelector('.gp-expand');
            expand.addEventListener('click', () => {
                const clamped = text.classList.toggle('gp-clamp');
                expand.textContent = clamped ? 'Развернуть' : 'Свернуть';
            });
            card.querySelector('.gp-insert').addEventListener('click', async ev => {
                const btn = ev.currentTarget;
                btn.disabled = true;
                try {
                    const ok = await insertGreeting(current, Number(card.dataset.index), s);
                    if (ok) closePicker();
                } catch (e) {
                    console.error('[Greeting Picker]', e);
                    notify('error', 'Не удалось вставить приветствие. Подробности в консоли.');
                } finally {
                    btn.disabled = false;
                }
            });
        });
    }

    renderList();
}

/* ---------------- Слэш-команда /greeting ---------------- */

async function slashHandler(named, value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        openPicker();
        return '';
    }
    const idx = parseInt(raw, 10);
    if (Number.isNaN(idx)) {
        notify('warning', 'Укажите номер: 0 — основное приветствие, 1, 2… — альтернативные.');
        return '';
    }
    const candidates = getCandidates();
    if (!candidates.length) {
        notify('warning', 'Откройте чат с персонажем.');
        return '';
    }
    let ch = candidates[0];
    if (named?.char) {
        const found = candidates.find(x => x.name.toLowerCase() === String(named.char).toLowerCase());
        if (!found) {
            notify('warning', `В этом чате нет персонажа ${named.char}.`);
            return '';
        }
        ch = found;
    }
    const s = getSettings();
    const mode = named?.mode === 'replace' || named?.mode === 'add' ? named.mode : s.mode;
    await insertGreeting(ch, idx, { mode, asSwipes: s.asSwipes });
    return '';
}

function registerSlash() {
    const c = ctx();
    const help = '<code>/greeting</code> — открыть окно выбора. <code>/greeting 2</code> — вставить альтернативное приветствие №2 (0 — основное). Аргументы: <code>mode=add|replace</code>, <code>char=Имя</code> (для группового чата).';
    try {
        const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } = c;
        if (SlashCommandParser && SlashCommand) {
            const props = {
                name: 'greeting',
                aliases: ['greet'],
                callback: (named, value) => slashHandler(named, value),
                helpString: help,
            };
            if (SlashCommandArgument && ARGUMENT_TYPE) {
                props.unnamedArgumentList = [SlashCommandArgument.fromProps({
                    description: 'номер приветствия',
                    typeList: [ARGUMENT_TYPE.NUMBER],
                    isRequired: false,
                })];
            }
            if (SlashCommandNamedArgument && ARGUMENT_TYPE) {
                props.namedArgumentList = [
                    SlashCommandNamedArgument.fromProps({ name: 'mode', description: 'add или replace', typeList: [ARGUMENT_TYPE.STRING], enumList: ['add', 'replace'] }),
                    SlashCommandNamedArgument.fromProps({ name: 'char', description: 'имя персонажа в групповом чате', typeList: [ARGUMENT_TYPE.STRING] }),
                ];
            }
            SlashCommandParser.addCommandObject(SlashCommand.fromProps(props));
        } else if (typeof c.registerSlashCommand === 'function') {
            c.registerSlashCommand('greeting', (args, value) => slashHandler(args, value), ['greet'], help, true, true);
        }
    } catch (e) {
        console.warn('[Greeting Picker] Слэш-команда не зарегистрирована:', e);
    }
}

/* ---------------- Кнопка в меню ---------------- */

function addMenuButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('gp_menu_button')) return;
    const item = document.createElement('div');
    item.id = 'gp_menu_button';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-comments extensionsMenuExtensionButton"></div><span>Вставить приветствие</span>';
    item.addEventListener('click', () => {
        // закрыть меню палочки, чтобы на телефоне оно не перекрывало окно
        $('#extensionsMenu').hide();
        openPicker();
    });
    menu.appendChild(item);
}

jQuery(() => {
    getSettings();
    addMenuButton();
    // На некоторых сборках меню создаётся позже — пробуем ещё раз
    setTimeout(addMenuButton, 1500);
    registerSlash();
});
