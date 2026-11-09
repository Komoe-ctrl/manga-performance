"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./field";

/**
 * Password field with a button to reveal what was typed. The button is named after the action
 * ("caractères"), not "mot de passe", so it never competes with the field for its own label.
 */
export function PasswordInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={`${className ?? ""} pr-10`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Masquer les caractères" : "Afficher les caractères"}
        aria-pressed={visible}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}
