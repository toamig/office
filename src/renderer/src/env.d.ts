/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in the web build, "0" in the desktop build; the Gallery view exists only in development or when "1". */
  readonly VITE_GALLERY?: "0" | "1";
}
