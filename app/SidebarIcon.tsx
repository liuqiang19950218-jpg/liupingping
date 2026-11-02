type SidebarIconName = "dashboard" | "document" | "customer" | "clock" | "issue" | "upload" | "settings";

/** Decorative navigation artwork. View state and click handlers stay in Home. */
export function SidebarIcon({ name, solid = false }: { name: SidebarIconName; solid?: boolean }) {
  if (solid) {
    return <svg className={`sidebar-solid-icon sidebar-solid-icon-${name}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {name === "dashboard" && <path d="m12 2-9 6.25 9 6.2 9-6.2L12 2Zm-8.2 10.4L12 18l8.2-5.6v3.2L12 21l-8.2-5.4v-3.2Z" />}
      {name === "document" && <path d="M5 2h9.3L20 7.7V22H5V2Zm8 1.9v5.4h5.1L13 3.9ZM8 12v1.7h8V12H8Zm0 3.4v1.7h8v-1.7H8Z" />}
      {name === "customer" && <path d="M12 2.2a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM3 21.8c.25-5.1 3.78-8.1 9-8.1s8.75 3 9 8.1H3Z" />}
      {name === "clock" && <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1.3 4.3v5l3.6 2.25-.9 1.5L11.5 12V6.3h1.8Z" />}
      {name === "issue" && <path d="M10.65 3h2.7l-.55 11.6h-1.6L10.65 3ZM12 17.1a2.05 2.05 0 1 1 0 4.1 2.05 2.05 0 0 1 0-4.1Z" />}
      {name === "upload" && <path d="m12 2-8.2 8.2H9v7.25h6v-7.25h5.2L12 2ZM3 20h18v2H3v-2Z" />}
      {name === "settings" && <path d="m10 2-.7 3-2 .9-2.7-1.5-2 3.4L5 10v3l-2.4 2.1 2 3.4 2.7-1.4 2 .9.7 3h4l.7-3 2-.9 2.7 1.4 2-3.4L19 13v-3l2.4-2.2-2-3.4-2.7 1.5-2-.9L14 2h-4Zm2 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" fillRule="evenodd" />}
    </svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === "dashboard" && <><path d="m3 9 9-6 9 6-9 6Z" fill="currentColor" stroke="none" /><path d="m3 14 9 6 9-6" strokeWidth="3" /></>}
    {name === "document" && <><path d="M5 2.5h10l4 4V22H5Z" /><path d="M14 3v5h5M8 12h8M8 16h8M8 19h5" /></>}
    {name === "customer" && <><circle cx="12" cy="7" r="5" fill="currentColor" stroke="none" /><path d="M2 22v-2a10 9 0 0 1 20 0v2Z" fill="currentColor" stroke="none" /></>}
    {name === "clock" && <><circle cx="12" cy="12" r="9" strokeWidth="2" /><path d="M12 6v6l3 2" strokeWidth="2" /></>}
    {name === "issue" && <><path d="m10 4 1 11h2l1-11Z" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.8" fill="currentColor" stroke="none" /></>}
    {name === "upload" && <><path d="M12 3 4 11h5v7h6v-7h5Z" fill="currentColor" stroke="none" /><path d="M4 21h16" strokeWidth="2.5" /></>}
    {name === "settings" && <path d="m10 2-.7 3-2 .9-2.7-1.5-2 3.4L5 10v3l-2.4 2.1 2 3.4 2.7-1.4 2 .9.7 3h4l.7-3 2-.9 2.7 1.4 2-3.4L19 13v-3l2.4-2.2-2-3.4-2.7 1.5-2-.9L14 2Zm2 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" fill="currentColor" fillRule="evenodd" stroke="none" />}
  </svg>;
}
