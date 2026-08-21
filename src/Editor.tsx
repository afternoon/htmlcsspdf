import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";

interface EditorProps {
  value: string;
  language: Extension;
  onChange: (value: string) => void;
  /** Accessible name, so the two editors are distinguishable. */
  label: string;
}

export function Editor({ value, language, onChange, label }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  // Keep the latest callback reachable without rebuilding the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Callers build the language extension inline (e.g. `language={htmlLang()}`),
  // so its identity changes on every parent render. A compartment lets us swap
  // it through a transaction instead of tearing down the view — recreating the
  // view would detach the focused DOM node and drop the cursor on every
  // keystroke.
  const languageCompartment = useRef(new Compartment());
  const languageRef = useRef(language);

  // Mounted once. `value` seeds the initial document, `label` is applied
  // imperatively, and `language` is swapped via the compartment below — none
  // of them may re-run this effect, since rebuilding the view detaches the
  // focused DOM node and drops the cursor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design
  useEffect(() => {
    if (!host.current) return;

    const compartment = languageCompartment.current;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        compartment.of(languageRef.current),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;
    // CodeMirror renders its own contenteditable; name that element rather
    // than the wrapper, since that is what receives focus.
    instance.contentDOM.setAttribute("aria-label", label);
    return () => {
      instance.destroy();
      view.current = null;
    };
  }, []);

  // Swap the language extension in place when it actually changes.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    if (languageRef.current === language) return;
    languageRef.current = language;
    instance.dispatch({
      effects: languageCompartment.current.reconfigure(language),
    });
  }, [language]);

  // Sync in values that came from outside the editor (e.g. a reset), without
  // clobbering the cursor while the user is typing.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  // Keep the name in sync if it ever changes.
  useEffect(() => {
    view.current?.contentDOM.setAttribute("aria-label", label);
  }, [label]);

  return <div className="editor" ref={host} />;
}
