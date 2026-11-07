"use strict";

const D = DASHBOARD_DATA;
const $ = id => document.getElementById(id);
const charts = new Map();
const firstDate = D.dates[0], lastDate = D.dates.at(-1);
const currency = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});
const compact = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2});
const decimal = new Intl.NumberFormat("en-US", {maximumFractionDigits: 2});
const dateFormat = new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", timeZone: "UTC"});
const colors = {green: "#215848", gold: "#a77329", rust: "#a24b36", blue: "#416c83", gray: "#728078"};
const chartFont = {family: "system-ui, sans-serif", size: 12};
const chartText = "#45574e";
const money = v => Number.isFinite(v) ? currency.format(v) : "—";
const shortMoney = v => Number.isFinite(v) ? compact.format(v) : "—";
const num = v => Number.isFinite(v) ? decimal.format(v) : "—";
const pct = (v, digits = 2) => Number.isFinite(v) ? (100 * v).toFixed(digits) + "%" : "—";
const div = (a, b) => b > 0 ? a / b : null;
const dateText = iso => dateFormat.format(new Date(iso + "T12:00:00Z"));
const esc = value => String(value ?? "—").replace(/[&<>"']/g, c => (
  {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]
));
const unique = values => [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
const inRange = iso => iso >= $("start-date").value && iso <= $("end-date").value;
const selectedDates = () => D.dates.filter(inRange);
let currentTab = "floor";

function optionList(id, allLabel, items) {
  const select = $(id);
  const previous = select.value;
  select.replaceChildren(new Option(allLabel, ""), ...items.map(([id, name]) => new Option(name, id)));
  if (items.some(([id]) => String(id) === previous)) select.value = previous;
}

function group(rows, key, make, update) {
  const groups = new Map();
  for (const row of rows) {
    const id = key(row);
    if (!groups.has(id)) groups.set(id, make());
    update(groups.get(id), row);
  }
  return groups;
}

function table(id, headers, rows, numericFrom = Infinity) {
  const host = $(id);
  if (!rows.length) {
    host.innerHTML = '<p class="empty">No records match this selection.</p>';
    return;
  }
  const cells = (row, tag) => row.map((value, i) =>
    "<" + tag + (tag === "th" ? ' scope="col"' : "") + (i >= numericFrom ? ' class="num"' : "") + ">" +
    (typeof value === "object" && value !== null ? value.html : esc(value)) + "</" + tag + ">"
  ).join("");
  host.innerHTML = "<table><thead><tr>" + cells(headers, "th") + "</tr></thead><tbody>" +
    rows.map(row => "<tr>" + cells(row, "td") + "</tr>").join("") + "</tbody></table>";
}

function kpis(id, cards) {
  $(id).innerHTML = cards.map(([label, value, note, emphasis]) =>
    '<div class="kpi' + (emphasis ? " feature" : "") + '"><div class="metric-label">' + esc(label) +
    '</div><div class="metric-value">' + esc(value) + '</div><div class="sub">' + esc(note) + "</div></div>"
  ).join("");
}

function line(label, data, color, extras = {}) {
  return {label, data, borderColor: color, backgroundColor: color, borderWidth: 2,
    pointRadius: data.filter(value => value !== null).length <= 1 ? 4 : 0,
    pointHoverRadius: 4, tension: 0, ...extras};
}

function bars(label, data, color) {
  return {label, data, backgroundColor: color, borderRadius: 3, maxBarThickness: 48};
}

function plot(id, labels, datasets, format = num, config = {}) {
  const {type = "line", marks = [], note, beginAtZero = false} = config;
  if (!window.Chart) return;
  const plugins = [{
    id: "date-markers",
    beforeDatasetsDraw(chart) {
      const {ctx, chartArea: area, scales: {x}} = chart;
      if (!area) return;
      for (const mark of marks) {
        const index = labels.findIndex(label => label >= mark.from);
        if (index < 0) continue;
        const pixel = x.getPixelForValue(index);
        ctx.save();
        if (mark.shade) {
          ctx.fillStyle = "#e8f1e8";
          ctx.fillRect(pixel, area.top, area.right - pixel, area.bottom - area.top);
        }
        ctx.strokeStyle = "#668a74";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(pixel, area.top);
        ctx.lineTo(pixel, area.bottom);
        ctx.stroke();
        ctx.restore();
      }
    }
  }];
  charts.get(id)?.destroy();
  charts.set(id, new Chart($(id), {
    type, data: {labels, datasets}, plugins,
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: {padding: {top: 4, right: 8}},
      interaction: {mode: "index", intersect: false},
      scales: {
        x: {grid: {display: false}, border: {color: "#d6ded1"}, ticks: {
          color: chartText, font: chartFont, padding: 6, maxTicksLimit: 8, maxRotation: 0, callback(index) {
          const label = labels[index];
          return /^\d{4}-\d\d-\d\d$/.test(label) ? dateText(label) : label;
        }}},
        y: {beginAtZero, grid: {color: "#e2e8de"}, border: {display: false}, ticks: {
          color: chartText, font: chartFont, padding: 6, maxTicksLimit: 6, callback: format
        }}
      },
      plugins: {
        legend: {
          display: datasets.length > 1, position: "bottom",
          labels: {color: chartText, font: chartFont, padding: 14, usePointStyle: true, boxWidth: 8}
        },
        tooltip: {
          backgroundColor: "#102a23", borderColor: "#b18b4c", borderWidth: 1,
          titleColor: "#f3d497", bodyColor: "#f4f8f4", footerColor: "#d6eadb",
          titleFont: {...chartFont, weight: "bold"}, bodyFont: chartFont,
          cornerRadius: 8, padding: 12, titleMarginBottom: 7, bodySpacing: 5,
          boxWidth: 8, boxHeight: 8, boxPadding: 5, multiKeyBackground: "#edf3e9",
          usePointStyle: true,
          callbacks: {
            label: context => context.dataset.label + " · " + format(context.parsed.y),
            afterBody: items => note?.(items[0]?.label) ?? ""
          }
        }
      }
    }
  }));
}

const newFloor = () => ({coin: 0, win: 0, theo: 0, available: 0, scheduled: 0, variance: 0, days: 0, places: new Set()});
function addFloor(total, row) {
  total.coin += row[4];
  total.win += row[5];
  total.theo += row[6];
  total.available += row[7];
  total.scheduled += row[8];
  total.variance += row[9];
  total.days += 1;
  total.places.add(row[2]);
}

const wagers = total => total.coin / 100;
const win = total => total.win / 100;
const theo = total => total.theo / 10000;
const hold = total => div(total.win, total.coin);
const availability = total => div(total.available, total.scheduled);
const theoRate = total => div(theo(total), total.available / 3600);
const wagerRate = total => div(wagers(total), total.available / 3600);
const payoutZ = total => div(win(total) - theo(total), Math.sqrt(total.variance));
const eventsByDate = new Map(D.demand.map(row => [row.gaming_date, row.event_names]));
const selectZone = () => $("zone").value;
const selectBank = () => $("bank").value;
const selectMachine = () => $("machine").value;
const zoneMatch = row => !selectZone() || String(row[2]) === selectZone();
const bankMatch = row => !selectBank() || String(row[3]) === selectBank();
const machineMatch = row => !selectMachine() || String(row[1]) === selectMachine();

function floorOptions(rows) {
  const zoneRows = rows.filter(zoneMatch);
  const banks = [...new Set(zoneRows.map(row => row[3]))].sort((a, b) => a - b);
  optionList("bank", "All banks", banks.map(i => [i, D.banks[i]]));
  const machines = [...new Set(zoneRows.filter(bankMatch).map(row => row[1]))].sort((a, b) => a - b);
  optionList("machine", "All machines", machines.map(i => [i, D.machine[i].machine_id]));
}

function drawFloor() {
  const dates = selectedDates();
  const from = D.dates.indexOf(dates[0]), to = D.dates.indexOf(dates.at(-1));
  const dated = D.floor.filter(row => row[0] >= from && row[0] <= to);
  floorOptions(dated);
  const scoped = dated.filter(row => zoneMatch(row) && bankMatch(row) && machineMatch(row));
  const floor = scoped.reduce((total, row) => {addFloor(total, row); return total;}, newFloor());
  const byDate = group(scoped, row => D.dates[row[0]], newFloor, addFloor);
  kpis("floor-kpis", [
    ["Coin-in", shortMoney(wagers(floor)), money(wagers(floor)) + " wagered"],
    ["House win", shortMoney(win(floor)), money(win(floor)) + " after payouts", true],
    ["Observed hold", pct(hold(floor)), "House win ÷ coin-in"],
    ["Availability", pct(availability(floor)), num(floor.available / 3600) + " of " + num(floor.scheduled / 3600) + " machine-hours"]
  ]);
  const metric = $("floor-measure").value;
  const series = read => dates.map(day => byDate.has(day) ? read(byDate.get(day)) : null);
  const datasets = {
    coin: () => [line("Coin-in", series(wagers), colors.green)],
    win: () => [line("House win", series(win), colors.green), line("Theo", series(theo), colors.gold)],
    hold: () => [line("Observed hold", series(hold), colors.green)],
    availability: () => [line("Availability", series(availability), colors.green)]
  };
  plot("floor-trend", dates, datasets[metric](), metric === "coin" || metric === "win" ? shortMoney : pct,
    {note: label => eventsByDate.get(label)});
  const zones = [...group(dated, row => row[2], newFloor, addFloor)]
    .map(([index, totals]) => [index, wagerRate(totals)])
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  $("zone-ranking").innerHTML = zones.map(([index, rate]) =>
    '<button class="zone-button" type="button" data-zone="' + index + '" aria-pressed="' + (String(index) === selectZone()) + '">' +
    "<span>" + esc(D.zones[index].zone_name) + "</span><strong>" + esc(money(rate)) + '</strong>' +
    '<span class="meter-track"><span class="meter-fill" style="width:' + (100 * (div(rate, zones[0][1]) ?? 0)) + '%"></span></span></button>'
  ).join("");
  drawMachineTable(scoped);
  drawDemand(dates);
  const calendarMonths = group(dates, day => day.slice(0, 7),
    newFloor, (total, day) => {
      const result = byDate.get(day);
      total.days += 1;
      if (result) {
        total.coin += result.coin;
        total.win += result.win;
        total.available += result.available;
      }
    });
  table("monthly-demand", ["Month", "Selected dates", "Wagers", "Wagers / day", "Wagers / available hr", "Observed hold"],
    [...calendarMonths].map(([month, row]) => [
      month, row.days, money(wagers(row)), money(div(wagers(row), row.days)), money(wagerRate(row)), pct(hold(row))
    ]), 1);
  const monthly = D.q2_evidence.monthly;
  const feb = monthly.find(row => row.month === "2025-02"), june = monthly.at(-1);
  $("macro-note").textContent = "Full-property context, February to June. Daily coin-in fell " +
    pct(1 - june.coin_in_per_day / feb.coin_in_per_day) + " while published Las Vegas visitors per day fell " +
    pct(1 - june.vegas_visitors_per_day / feb.vegas_visitors_per_day) +
    ". NOAA temperatures rose across the six months. Missouri slot hold provides a separate benchmark.";
  drawDowntime();
}

function drawMachineTable(scoped) {
  const mode = $("rank-mode").value;
  const selected = selectMachine();
  const totals = [...group(scoped, row => row[1], newFloor, addFloor)]
    .filter(([index]) => {
      const m = D.machine[index];
      if (selected || mode === "all") return true;
      if (mode === "gm") return m.gm_rank <= 10;
      if (mode === "leads") return m.payout_inspection || m.low_local_demand;
      return m.payout_inspection || m.low_local_demand || m.high_downtime || m.weak_location || m.short_exposure;
    })
    .sort((a, b) => D.machine[a[0]].gm_rank - D.machine[b[0]].gm_rank);
  $("machine-note").textContent = selected
    ? "Selected machine " + D.machine[Number(selected)].machine_id + " · its full-study evidence is shown alongside filtered metrics."
    : "One payout inspection lead. M-1120 was the only machine below both local demand benchmarks and also had short exposure.";
  table("machine-table", ["Machine", "Full-study screen", "Days", "Availability", "House win", "Theo", "Theo/hour", "Hold", "Payout z"],
    totals.map(([i, row]) => {
      const m = D.machine[i];
      const flags = m.payout_inspection ? "inspect" : m.low_local_demand || m.gm_rank <= 10 ? "warn" : "";
      const extra = m.low_local_demand && m.short_exposure ? " · low local demand" : "";
      return [
        {html: '<button class="table-link" type="button" data-machine="' + i + '">' + esc(m.machine_id) +
          "</button>" + (m.gm_rank <= 10 ? " · #" + m.gm_rank : "")},
        {html: '<span class="pill ' + flags + '">' + esc(m.primary_diagnosis + extra) + "</span>"},
        num(row.days), pct(availability(row)), money(win(row)), money(theo(row)),
        money(theoRate(row)), pct(hold(row)), num(payoutZ(row))
      ];
    }), 2);
  const moves = [];
  const prior = new Map();
  for (const placement of D.placement) {
    const before = prior.get(placement.machine_id);
    prior.set(placement.machine_id, placement);
    if (before && before.location_id !== placement.location_id) moves.push([before, placement]);
  }
  table("moves-table", ["Machine", "Date moved", "Previous location", "New location", "Theo/hr before", "Theo/hr after", "Change"],
    moves.map(([before, after]) => [
      after.machine_id, after.first_gaming_date, before.zone_name + " · " + before.location_id,
      after.zone_name + " · " + after.location_id, money(before.theo_per_available_hour),
      money(after.theo_per_available_hour), pct(div(after.theo_per_available_hour, before.theo_per_available_hour) - 1)
    ]), 4);
  const history = $("machine-placements");
  history.replaceChildren();
  if (!selected) return;
  const machine = D.machine[Number(selected)];
  const scopedTotal = totals[0]?.[1];
  const details = document.createElement("div");
  details.className = "mini-note";
  details.textContent = machine.theme + " · " + machine.manufacturer + " · full-study z " +
    num(machine.payout_z) + " · local same-game theo index " + pct(machine.zone_same_config_theo_index, 1) +
    " · bank theo index " + pct(machine.bank_theo_index, 1);
  if (scopedTotal) details.textContent += " · selected hold " + pct(hold(scopedTotal)) +
    " vs " + pct(div(theo(scopedTotal), wagers(scopedTotal))) + " theoretical · " +
    money(win(scopedTotal) - theo(scopedTotal)) + " payout residual";
  history.append(details);
  const placements = document.createElement("div");
  placements.id = "placement-table";
  placements.className = "table-scroll";
  history.append(placements);
  table("placement-table", ["Placement", "Zone", "Bank", "Configuration", "Observed dates", "Theo/hour", "Same-game floor index"],
    D.placement.filter(row => row.machine_id === machine.machine_id).map(row => [
      row.location_id, row.zone_name, row.bank_id, row.config_id, row.first_gaming_date + " – " + row.last_gaming_date,
      money(row.theo_per_available_hour), pct(row.floor_same_config_theo_index, 1)
    ]), 5);
}

function drawDemand(dates) {
  const periods = ["Before", "During", "After"];
  const closure = D.q2_evidence.closure;
  const read = (phase, area) => closure.find(row => row.phase === phase && row.area === area);
  plot("closure-chart", periods, [
    bars("Back Forty", periods.map(phase => read(phase, "Back Forty").coin_in_per_available_hour), colors.green),
    bars("Other zones", periods.map(phase => read(phase, "Other zones").coin_in_per_available_hour), colors.gold)
  ], money, {type: "bar", beginAtZero: true});
  table("closure-table", ["Back Forty", "Wagers / available hr", "Entries / valid hr", "Sensor coverage"],
    periods.map(phase => {
      const row = read(phase, "Back Forty");
      return [phase, money(row.coin_in_per_available_hour), num(row.entries_per_valid_hour), pct(row.sensor_coverage)];
    }), 1);
  const activeZone = selectZone() === "" ? null : D.zones[Number(selectZone())];
  const daily = D.zoneDaily.filter(row => inRange(row.gaming_date) && (!activeZone || row.zone_id === activeZone.zone_id));
  const add = (total, row) => {
    total.entries += row.observed_entries ?? 0;
    total.hours += row.valid_counter_hours;
    total.slots += row.reported_counter_slots;
  };
  const create = () => ({entries: 0, hours: 0, slots: 0});
  const byDate = group(daily, row => row.gaming_date, create, add);
  plot("traffic-chart", dates, [line("Entries per valid hour", dates.map(day => {
    const row = byDate.get(day);
    return row ? div(row.entries, row.hours) : null;
  }), colors.blue)], num, {note: label => eventsByDate.get(label)});
  const sum = daily.reduce((acc, row) => {add(acc, row); return acc;}, create());
  $("traffic-note").textContent = (activeZone?.zone_name ?? "All zones") + " · " +
    pct(div(sum.hours, sum.slots)) + " valid sensor coverage. February led property wagers per day; June was lowest.";
  const events = D.q2_evidence.events.filter(row => row.end_date >= dates[0] && row.start_date <= dates.at(-1));
  table("events-table", ["Scheduled event", "Study lift vs matched days"], events.map(row => [row.name, pct(row.difference, 1)]), 1);
}

function drawDowntime() {
  const zone = selectZone() === "" ? null : D.zones[Number(selectZone())].zone_id;
  const bank = selectBank() === "" ? null : D.banks[Number(selectBank())];
  const machine = selectMachine() === "" ? null : D.machine[Number(selectMachine())].machine_id;
  const rows = D.downtime.filter(row => inRange(row.gaming_date) && (!zone || row.zone_id === zone) &&
    (!bank || row.bank_id === bank) && (!machine || row.machine_id === machine));
  const create = () => ({seconds: 0, coin: 0, theo: 0});
  const add = (a, b) => {a.seconds += b.seconds; a.coin += b.coin; a.theo += b.theo;};
  const total = rows.reduce((sum, row) => {add(sum, row); return sum;}, create());
  kpis("down-kpis", [
    ["Measured downtime", num(total.seconds / 3600) + " h", "Reconciled to meter exposure"],
    ["Estimated lost wagers", shortMoney(total.coin), money(total.coin)],
    ["Estimated lost theo", shortMoney(total.theo), money(total.theo), true]
  ]);
  const field = $("down-group").value;
  const groups = [...group(rows, row => row[field], create, add)].sort((a, b) => b[1].theo - a[1].theo);
  table("down-table", ["Group", "Machine-hours down", "Est. wagers lost", "Est. theo lost"], groups.map(([label, row]) =>
    [String(label ?? "Unknown").replaceAll("_", " "), num(row.seconds / 3600), money(row.coin), money(row.theo)]), 1);
  table("staffing-table", ["Shift", "Technicians", "Shifts", "Down hours / shift", "Est. theo lost", "Waiting-for-work theo"],
    D.q3_evidence.staffing.map(row => [row.shift, row.techs, row.staffed_shifts, num(row.downtime_hours_per_shift),
      money(row.lost_theo_usd), money(row.queue_theo_usd)]), 1);
}

const guestTotal = () => ({coin: 0, payout: 0, win: 0, theo: 0, segments: 0});
function addGuest(total, row) {
  for (const field of ["coin", "payout", "win", "theo", "segments"]) total[field] += row[field] ?? 0;
}

function drawGuests() {
  const dates = selectedDates();
  const tier = $("tier").value, age = $("age").value, region = $("region").value;
  const rows = D.guests.filter(row => inRange(row.gaming_date) && (!tier || row.tier === tier) &&
    (!age || row.age_band === age) && (!region || row.home_region === region));
  const selected = rows.reduce((total, row) => {addGuest(total, row); return total;}, guestTotal());
  kpis("guest-kpis", [
    ["Carded wagers", shortMoney(selected.coin), num(selected.segments) + " session segments"],
    ["Payouts", shortMoney(selected.payout), money(selected.payout)],
    ["Net guest loss", shortMoney(selected.win), money(selected.win) + " house win", true],
    ["Theoretical win", shortMoney(selected.theo), money(selected.theo)]
  ]);
  const daily = group(rows, row => row.gaming_date, guestTotal, addGuest);
  plot("guest-chart", dates, [
    line("Carded wagers", dates.map(day => daily.get(day)?.coin ?? null), colors.green),
    line("Payouts", dates.map(day => daily.get(day)?.payout ?? null), colors.blue)
  ], shortMoney);
  const carded = guestTotal(), uncarded = guestTotal();
  for (const row of D.carded.filter(row => inRange(row.gaming_date))) {
    addGuest(carded, row);
    for (const field of ["coin", "payout", "win", "theo"]) uncarded[field] += row["all_" + field] - row[field];
  }
  table("carded-table", ["Play", "Wagers", "Payouts", "Net house win", "Theo", "Share of wagers"],
    [["Carded", carded], ["Uncarded", uncarded]].map(([label, row]) => [
      label, money(row.coin), money(row.payout), money(row.win), money(row.theo), pct(div(row.coin, carded.coin + uncarded.coin))
    ]), 1);
  drawConcentration(tier, age, region);
  drawComps(dates, tier);
}

function showConcentration(q4) {
  const cohort = [0, ...q4.lorenz.map(row => row.guest_share)];
  plot("lorenz-chart", cohort.map(value => pct(value, 0)), [
    line("Equal share", cohort, "#969d96", {borderDash: [5, 4]}),
    line("Wagers", [0, ...q4.lorenz.map(row => row.wager_share)], colors.green),
    line("Positive net losses", [0, ...q4.lorenz.map(row => row.positive_loss_share)], colors.gold)
  ], value => pct(value, 0), {beginAtZero: true});
  const gini = value => Number.isFinite(value) ? value.toFixed(3) : "—";
  $("concentration-note").textContent = num(q4.tracked.wagering_guests) + " wagering cardholders · wager Gini " +
    gini(q4.gini.wager_gini) + " · positive-loss Gini " + gini(q4.gini.positive_loss_gini);
  table("concentration-table", ["Top cohort", "Guests", "Wager share", "Net house win share"],
    q4.shares.map(row => [pct(row.cutoff, 0), num(row.top_players), pct(row.wager_share), pct(row.net_house_win_share)]), 1);
}

let guestBalances;
let concentrationRequest = 0;
const concentrationCache = new Map();
function decodeBalances() {
  if (!guestBalances) {
    const bytes = Uint8Array.from(atob(D.guestDays), char => char.charCodeAt(0));
    const decoded = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    guestBalances = new Response(decoded).arrayBuffer().then(buffer => new DataView(buffer));
  }
  return guestBalances;
}

function cohortStats(data, start, end, segments) {
  const balances = new Map();
  for (let offset = 0; offset < data.byteLength; offset += 14) {
    const date = data.getUint8(offset);
    if (date > end) break;
    if (date < start || !segments.has(data.getUint8(offset + 1))) continue;
    const guest = data.getUint32(offset + 2, true);
    if (!balances.has(guest)) balances.set(guest, [0, 0]);
    const row = balances.get(guest);
    row[0] += data.getInt32(offset + 6, true);
    row[1] += data.getInt32(offset + 10, true);
  }
  const count = balances.size;
  const wagers = [...balances.values()].map(row => row[0]).sort((a, b) => a - b);
  const losses = [...balances.values()].map(row => row[1]).sort((a, b) => a - b);
  const sum = values => values.reduce((a, b) => a + b, 0);
  const wagerSum = sum(wagers), lossSum = sum(losses);
  const positive = losses.map(value => Math.max(0, value)), positiveSum = sum(positive);
  const gini = (values, total) => div(values.reduce((acc, value, i) => acc + (2 * i + 1 - count) * value, 0), count * total);
  const shares = count === 0 ? [] : [1, 5, 10, 20].map(percent => {
    const n = Math.ceil(count * percent / 100);
    return {cutoff: percent / 100, top_players: n, wager_share: div(sum(wagers.slice(-n)), wagerSum),
      net_house_win_share: div(sum(losses.slice(-n)), lossSum)};
  });
  const lorenz = [];
  let accumulatedWager = 0, accumulatedLoss = 0;
  for (let i = 0; i < count; i++) {
    accumulatedWager += wagers[i];
    accumulatedLoss += positive[i];
    if (i === count - 1 || Math.floor(i * 100 / count) < Math.floor((i + 1) * 100 / count)) {
      lorenz.push({guest_share: (i + 1) / count, wager_share: div(accumulatedWager, wagerSum),
        positive_loss_share: div(accumulatedLoss, positiveSum)});
    }
  }
  return {tracked: {wagering_guests: count}, shares, lorenz,
    gini: {wager_gini: gini(wagers, wagerSum), positive_loss_gini: gini(positive, positiveSum)}};
}

async function drawConcentration(tier, age, region) {
  const request = ++concentrationRequest;
  const start = $("start-date").value, end = $("end-date").value;
  if (start === firstDate && end === lastDate && !tier && !age && !region) {
    showConcentration(D.q4_evidence);
    return;
  }
  const key = [start, end, tier, age, region].join("|");
  if (concentrationCache.has(key)) {
    showConcentration(concentrationCache.get(key));
    return;
  }
  $("concentration-note").textContent = "Calculating concentration for the selected guests…";
  $("concentration-table").replaceChildren();
  charts.get("lorenz-chart")?.destroy();
  try {
    const data = await decodeBalances();
    if (request !== concentrationRequest || currentTab !== "guests") return;
    const segments = new Set(D.guestSegments.flatMap(([t, a, r], i) =>
      (!tier || t === tier) && (!age || a === age) && (!region || r === region) ? [i] : []));
    const result = cohortStats(data, D.dates.indexOf(start), D.dates.indexOf(end), segments);
    if (concentrationCache.size >= 20) concentrationCache.delete(concentrationCache.keys().next().value);
    concentrationCache.set(key, result);
    showConcentration(result);
  } catch {
    if (request === concentrationRequest) $("concentration-note").textContent =
      "Filtered concentration is unavailable in this browser. The full-period cohort remains available after clearing filters.";
  }
}

function drawComps(dates, selectedTier) {
  const create = () => ({cost: 0, theo: 0, coin: 0, earned: 0, redeemed: 0, count: 0});
  const add = (a, b) => {
    a.cost += b.comp_cost_usd;
    a.theo += b.carded_theo_usd;
    a.coin += b.carded_coin_in_usd;
    a.earned += b.points_earned;
    a.redeemed += b.points_redeemed;
    a.count += b.redemptions;
  };
  const comps = D.comps.filter(row => inRange(row.gaming_date));
  const sum = comps.reduce((total, row) => {add(total, row); return total;}, create());
  kpis("comp-kpis", [
    ["Comp cost", shortMoney(sum.cost), money(sum.cost), true],
    ["Reinvestment", pct(div(sum.cost, sum.theo)), pct(div(sum.cost, sum.coin), 3) + " of carded wagers"]
  ]);
  const monthly = [...group(comps, row => row.gaming_date.slice(0, 7), create, add)];
  plot("comp-chart", monthly.map(([month]) => month), [
    bars("Comp cost ÷ carded theo", monthly.map(([, row]) => div(row.cost, row.theo)), colors.green)
  ], pct, {type: "bar", beginAtZero: true});
  table("comp-table", ["Month", "Comp cost", "Reinvestment", "Redemptions", "Points earned", "Points spent"],
    monthly.map(([month, row]) => [month, money(row.cost), pct(div(row.cost, row.theo)),
      num(row.count), num(row.earned), num(row.redeemed)]), 1);
  const tiers = selectedTier ? [selectedTier] : unique(D.compTiers.map(row => row.tier));
  const byTier = new Map(D.compTiers.map(row => [row.tier + row.gaming_date, row]));
  const tierColor = {Base: colors.blue, Gold: colors.gold, Platinum: colors.green};
  plot("tier-chart", dates, tiers.map(tier => line(tier, dates.map(day => {
    const row = byTier.get(tier + day);
    return row ? div(row.points_spent, row.face_usd) : null;
  }), tierColor[tier] ?? colors.gray)), num, {marks: [{from: "2025-05-01"}]});
  const pricing = D.q5_evidence.pricing;
  table("pricing-table", ["Tier at redemption", "Jan–Apr pts/$", "May–Jun pts/$"], tiers.map(tier => [
    tier, ...pricing.filter(row => row.tier === tier).map(row => num(row.points_per_face_dollar))
  ]), 1);
}

function drawModel() {
  const evidence = D.model_evidence;
  const scores = evidence.metrics;
  const improvement = 1 - scores.model.mae_usd / scores.weekday_baseline.mae_usd;
  kpis("model-kpis", [
    ["Calendar model MAE", money(scores.model.mae_usd), pct(improvement, 1) + " below weekday baseline", true],
    ["Weekday baseline MAE", money(scores.weekday_baseline.mae_usd), "Jan–Apr weekday means"],
    ["Constant baseline MAE", money(scores.constant_baseline.mae_usd), "Jan–Apr overall mean"],
    ["Holdout days", num(evidence.holdout_days), "May 1–June 30, 2025"]
  ]);
  const rows = D.forecast.filter(row => inRange(row.gaming_date));
  plot("validation-chart", rows.map(row => row.gaming_date), [
    line("Actual", rows.map(row => row.actual_usd), colors.green),
    line("Constant baseline", rows.map(row => row.constant_baseline_usd), colors.gray, {borderDash: [4, 5]}),
    line("Weekday baseline", rows.map(row => row.weekday_baseline_usd), colors.blue, {borderDash: [3, 3]}),
    line("Calendar model", rows.map(row => row.forecast_usd), colors.gold)
  ], shortMoney, {marks: [{from: "2025-05-01", shade: true}], note: label => {
    const row = rows.find(row => row.gaming_date === label);
    return row ? row.split : "";
  }});
  table("model-table", ["May–June holdout", "MAE", "RMSE"], [
    ["Calendar model", scores.model],
    ["Weekday baseline", scores.weekday_baseline],
    ["Constant baseline", scores.constant_baseline]
  ].map(([label, score]) => [label, money(score.mae_usd), money(score.rmse_usd)]), 1);
  const week = evidence.july_weekdays;
  $("july-decision").textContent = "Pre-stage existing repair coverage for Friday–Sunday and use Tuesday for planned work when practical. " +
    "The calendar model projects " + shortMoney(week[0].forecast_usd_per_day) + " on a typical Saturday versus " +
    shortMoney(week.at(-1).forecast_usd_per_day) + " on Tuesday. This is a calendar-only forecast for July with the event schedule available at the model cutoff.";
  plot("july-chart", week.map(row => row.weekday.slice(0, 3)), [
    bars("Forecast coin-in per day", week.map(row => row.forecast_usd_per_day), colors.green)
  ], shortMoney, {type: "bar", beginAtZero: true});
}

function drawBudget() {
  const plan = D.q6_budget_plan;
  kpis("budget-kpis", [
    ["Planned spend", money(plan.spent_usd), "Two catalog actions", true],
    ["Budget retained", money(plan.retained_usd), "From " + money(plan.budget_usd)],
    ["Base net benefit", money(plan.net_base_usd), "Modeled contribution less cost"],
    ["Low to high net benefit", shortMoney(plan.net_low_usd) + " to " + shortMoney(plan.net_high_usd), "Sensitivity scenarios"]
  ]);
  $("budget-actions").innerHTML = plan.actions.map((action, index) =>
    '<article class="panel action-card"><div class="panel-head"><div><div class="kicker">' +
    esc(action.action_type_id) + "</div><h3>" + esc(action.name) + '</h3><p class="sub">' + esc(action.target) +
    '</p></div><div class="action-price">' + esc(money(action.cost_usd)) + "</div></div>" +
    "<dl><dt>Quantity / limit</dt><dd>" + action.quantity + " / " + action.quantity_limit +
    "</dd><dt>Cost calculation</dt><dd>" + action.quantity + " × (" + esc(money(action.unit_cost_cents / 100)) +
    " + " + esc(money(action.recurring_cost_cents_per_day / 100)) + " × " + action.active_days + ")" +
    "</dd><dt>Lead / active days</dt><dd>" + action.lead_days + " / " + action.active_days +
    "</dd><dt>First active date</dt><dd>" + esc(dateText(action.activation_date)) +
    "</dd><dt>Planned machine outage</dt><dd>" + action.downtime_minutes + " minutes</dd></dl>" +
    '<div class="table-scroll" id="scenario-' + index + '"></div><p class="mini-note">' + esc(action.evidence) +
    "</p><p><strong>Scenario assumptions.</strong> " + esc(action.assumptions) +
    "</p><p><strong>How to measure it.</strong> " + esc(action.measurement) +
    '</p><a class="button" href="#' + esc(action.evidence_link) + '-evidence" data-evidence="' +
    esc(action.evidence_link) + '">Open supporting evidence ↗</a></article>'
  ).join("");
  plan.actions.forEach((action, index) => table("scenario-" + index,
    ["Scenario", "Operating benefit", "Net benefit", "ROI"],
    ["low", "base", "high"].map(key => [
      key[0].toUpperCase() + key.slice(1), money(action["gross_" + key + "_usd"]),
      money(action["net_" + key + "_usd"]), pct(action["roi_" + key], 1)
    ]), 1));
}

const renderers = {floor: drawFloor, guests: drawGuests, model: drawModel, budget: drawBudget};
const tabs = [...document.querySelectorAll("[data-tab]")];

function render() {
  const count = selectedDates().length;
  $("date-status").textContent = num(count) + (count === 1 ? " gaming date selected" : " gaming dates selected");
  renderers[currentTab]();
}

function showTab(tab) {
  currentTab = tab;
  for (const button of tabs) {
    const isActive = button.dataset.tab === tab;
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
    $(button.dataset.tab).hidden = !isActive;
  }
  render();
}

function fullPeriod() {
  $("start-date").value = firstDate;
  $("end-date").value = lastDate;
}

function updateDates(event) {
  const start = $("start-date"), end = $("end-date");
  for (const [input, fallback] of [[start, firstDate], [end, lastDate]]) {
    if (!input.value) input.value = fallback;
    if (input.value < firstDate) input.value = firstDate;
    if (input.value > lastDate) input.value = lastDate;
  }
  if (start.value > end.value) {
    if (event.target === start) end.value = start.value;
    else start.value = end.value;
  }
  render();
}

function openEvidence(target) {
  fullPeriod();
  $("zone").value = D.zones.findIndex(row => row.zone_id === "Z-B40");
  $("rank-mode").value = "gm";
  $("bank").value = "";
  $("machine").value = "";
  if (target === "inspection") {
    floorOptions(D.floor);
    $("bank").value = D.banks.indexOf("B-31");
    floorOptions(D.floor);
    $("machine").value = D.machine.findIndex(row => row.machine_id === "M-1158");
  }
  showTab("floor");
  const evidence = $(target + "-evidence");
  evidence.focus({preventScroll: true});
  evidence.scrollIntoView({block: "start"});
}

optionList("zone", "All zones", D.zones.map((row, index) => [index, row.zone_name]));
for (const [id, key, label] of [
  ["tier", "tier", "All tiers"], ["age", "age_band", "All age bands"], ["region", "home_region", "All regions"]
]) {
  optionList(id, label, unique(D.guests.map(row => row[key])).map(value => [value, value]));
}
$("hero-plan").textContent = money(D.q6_budget_plan.spent_usd) + " proposed · " +
  money(D.q6_budget_plan.retained_usd) + " retained.";
for (const id of ["start-date", "end-date"]) $(id).addEventListener("change", updateDates);
$("reset-dates").addEventListener("click", () => {fullPeriod(); render();});
for (const id of ["zone", "bank", "machine", "rank-mode", "floor-measure", "down-group", "tier", "age", "region"]) {
  $(id).addEventListener("change", () => {
    if (id === "zone") $("bank").value = "";
    if (id === "zone" || id === "bank") $("machine").value = "";
    render();
  });
}
tabs.forEach((button, index) => {
  button.addEventListener("click", () => showTab(button.dataset.tab));
  button.addEventListener("keydown", event => {
    const indexes = {ArrowLeft: (index - 1 + tabs.length) % tabs.length, ArrowRight: (index + 1) % tabs.length,
      Home: 0, End: tabs.length - 1};
    if (!(event.key in indexes)) return;
    event.preventDefault();
    const next = tabs[indexes[event.key]];
    showTab(next.dataset.tab);
    next.focus();
  });
});
$("zone-ranking").addEventListener("click", event => {
  const button = event.target.closest("[data-zone]");
  if (!button) return;
  $("zone").value = selectZone() === button.dataset.zone ? "" : button.dataset.zone;
  $("zone").dispatchEvent(new Event("change"));
});
$("machine-table").addEventListener("click", event => {
  const button = event.target.closest("[data-machine]");
  if (!button) return;
  $("machine").value = button.dataset.machine;
  drawFloor();
  $("machine").focus();
});
$("budget-actions").addEventListener("click", event => {
  const link = event.target.closest("[data-evidence]");
  if (!link) return;
  event.preventDefault();
  history.pushState(null, "", link.hash);
  openEvidence(link.dataset.evidence);
});
function handleEvidenceHash() {
  const match = location.hash.match(/^#(inspection|wayfinding)-evidence$/);
  if (match) openEvidence(match[1]);
  else render();
}
window.addEventListener("hashchange", handleEvidenceHash);
handleEvidenceHash();
