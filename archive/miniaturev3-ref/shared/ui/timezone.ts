export const getVenezuelaTimeParts = (date: Date = new Date()) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Caracas",
    hour12: false,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value || "0");
  const dayOfWeek = new Date(
    date.toLocaleString("en-US", { timeZone: "America/Caracas" }),
  ).getDay();
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    dayOfWeek,
  };
};

export const getVenezuelaNow = (): Date => {
  const p = getVenezuelaTimeParts();
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute);
};

export const todayVET = (): string => {
  const p = getVenezuelaTimeParts();
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

export const isTodayVET = (f: string): boolean => f === todayVET();
