import { useEffect, useState } from 'react';
import type { RecentWorkspace } from '@shared/file-types';
import { runCommand } from '../commands/registry';
import { useEditorStore } from '../store/useEditorStore';
import { openRecentWorkspace } from '../utils/recentWorkspaces';

const shortcuts = [
  { label: 'Open a file', detail: 'Start with something local', keys: 'Ctrl O', command: 'file.open', icon: 'file' },
  { label: 'Open a workspace', detail: 'Bring a project into Carlo', keys: null, command: 'workspace.openFolder', icon: 'folder' },
  { label: 'Quick open', detail: 'Jump anywhere, instantly', keys: 'Ctrl P', command: 'workbench.action.quickOpen', icon: 'search' },
] as const;

const actionIcons = {
  file: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.75h8l4 4v12.5H6z" /><path d="M14 3.75v4h4" /></svg>,
  folder: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.75 6.5h6l1.75 2h8.75v10.75H3.75z" /></svg>,
  search: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.75" /><path d="m15 15 4.25 4.25" /></svg>,
};

const quotes = [
  { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { text: 'Stay hungry. Stay foolish.', author: 'Steve Jobs' },
  { text: 'Programs must be written for people to read.', author: 'Harold Abelson' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Well begun is half done.', author: 'Aristotle' },
  { text: 'The journey of a thousand miles begins with one step.', author: 'Lao Tzu' },
  { text: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
  { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' },
  { text: 'Premature optimization is the root of all evil.', author: 'Donald Knuth' },
  { text: 'Any sufficiently advanced technology is indistinguishable from magic.', author: 'Arthur C. Clarke' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'What I cannot create, I do not understand.', author: 'Richard Feynman' },
  { text: 'Everything should be made as simple as possible, but not simpler.', author: 'Albert Einstein' },
  { text: 'If I have seen further, it is by standing on the shoulders of giants.', author: 'Isaac Newton' },
  { text: 'It always seems impossible until it is done.', author: 'Nelson Mandela' },
  { text: 'The best way to predict the future is to invent it.', author: 'Alan Kay' },
  { text: 'Knowledge is power.', author: 'Francis Bacon' },
  { text: 'I have not failed. I have just found 10,000 ways that will not work.', author: 'Thomas Edison' },
  { text: 'The details are not the details. They make the design.', author: 'Charles Eames' },
  { text: 'Design is not just what it looks like and feels like. Design is how it works.', author: 'Steve Jobs' },
  { text: 'Code is like humor. When you have to explain it, it is bad.', author: 'Cory House' },
  { text: 'First, solve the problem. Then, write the code.', author: 'John Johnson' },
  { text: 'Experience is the name everyone gives to their mistakes.', author: 'Oscar Wilde' },
  { text: 'In theory, theory and practice are the same. In practice, they are not.', author: 'Yogi Berra' },
  { text: 'The most effective debugging tool is still careful thought.', author: 'Brian Kernighan' },
  { text: 'Controlling complexity is the essence of computer programming.', author: 'Brian Kernighan' },
  { text: 'Deleted code is debugged code.', author: 'Jeff Sickel' },
  { text: 'Walking on water and developing software from a specification are easy if both are frozen.', author: 'Edward V. Berard' },
  { text: 'The function of good software is to make the complex appear simple.', author: 'Grady Booch' },
  { text: 'There are two ways of constructing a software design: make it simple, or make it so complicated there are no obvious deficiencies.', author: 'C. A. R. Hoare' },
  { text: 'Perfection is achieved when there is nothing left to take away.', author: 'Antoine de Saint-Exupéry' },
  { text: 'The art challenges the technology, and the technology inspires the art.', author: 'John Lasseter' },
  { text: 'The quieter you become, the more you are able to hear.', author: 'Rumi' },
  { text: 'Do not wait to strike till the iron is hot; make it hot by striking.', author: 'William Butler Yeats' },
  { text: 'Luck is what happens when preparation meets opportunity.', author: 'Seneca' },
  { text: 'A good plan violently executed now is better than a perfect plan next week.', author: 'George S. Patton' },
  { text: 'If you want to go fast, go alone. If you want to go far, go together.', author: 'African proverb' },
  { text: 'The obstacle is the way.', author: 'Marcus Aurelius' },
];

const quote = quotes[Math.floor(Math.random() * quotes.length)]!;

export function WelcomeScreen() {
  return (
    <div className="welcome-screen">
      <div className="welcome-aurora welcome-aurora-one" aria-hidden="true" />
      <div className="welcome-aurora welcome-aurora-two" aria-hidden="true" />
      <div className="welcome-card">
        <div className="welcome-hero">
          <div className="welcome-logo" aria-hidden="true"><span /></div>
          <p className="welcome-kicker">Carlo · Focused by design</p>
          <h1>Code at the<br /><em>speed of thought.</em></h1>
          <p className="welcome-subtitle">A precise, beautifully quiet space for making exceptional software.</p>
        </div>
        <div className="welcome-side">
          <div className="welcome-actions">
            {shortcuts.map((shortcut) => (
              <button key={shortcut.command} onClick={() => void runCommand(shortcut.command)}>
                <span className="welcome-action-icon">{actionIcons[shortcut.icon]}</span>
                <span className="welcome-action-copy">
                  <strong>{shortcut.label}</strong>
                  <small>{shortcut.detail}</small>
                </span>
                {shortcut.keys ? <kbd>{shortcut.keys}</kbd> : null}
              </button>
            ))}
          </div>
          <RecentWorkspaces />
        </div>
        <figure className="welcome-quote">
          <blockquote>“{quote.text}”</blockquote>
          <figcaption>{quote.author}</figcaption>
        </figure>
        <p className="welcome-hint">
          <span aria-hidden="true">✦</span> Press <kbd>Ctrl Shift P</kbd> to make Carlo do almost anything.
        </p>
      </div>
    </div>
  );
}

const maxRecentShown = 5;

function RecentWorkspaces() {
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);
  const currentRoot = useEditorStore((state) => state.workspace?.rootPath);

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      window.api.workspace.recent
        .list()
        .then((list) => {
          if (!disposed) setRecent(list);
        })
        .catch(console.error);
    };
    refresh();
    const off = window.api.workspace.recent.onChanged(refresh);
    return () => {
      disposed = true;
      off();
    };
  }, []);

  const entries = recent.filter((entry) => entry.path !== currentRoot).slice(0, maxRecentShown);
  if (entries.length === 0) return null;

  return (
    <section className="welcome-recent" aria-label="Recent folders">
      <h2>Recent</h2>
      <ul>
        {entries.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              className="welcome-recent-open"
              title={entry.path}
              onClick={() => void openRecentWorkspace(entry.path)}
            >
              <strong>{entry.name}</strong>
              <small>{entry.displayPath}</small>
            </button>
            <button
              type="button"
              className="welcome-recent-remove"
              title="Remove from Recent"
              aria-label={`Remove ${entry.name} from Recent`}
              onClick={() => void window.api.workspace.recent.remove(entry.path).catch(console.error)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
