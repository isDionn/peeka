const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const p2 = (n: number) => String(n).padStart(2, "0");
const hm = (d: Date) => `${d.getHours() % 12 || 12}:${p2(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;

/** "Thu Oct 16" and "2:32 PM" separately (the time is bold). en-US order, built by hand so it doesn't depend on the system's Intl data. */
export function clockParts(d: Date) {
  return {
    date: `${DAY[d.getDay()]} ${MONTH[d.getMonth()]} ${d.getDate()}`,
    time: hm(d),
    label: `${DAY_LONG[d.getDay()]}, ${MONTH_LONG[d.getMonth()]} ${d.getDate()}, ${hm(d)}`,
  };
}
