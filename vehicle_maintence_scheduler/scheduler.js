export function scheduleDepot(vehicles, availableHours) {
  const n = vehicles.length;
  const dp = [];
  
  for (let i = 0; i <= n; i++) {
    dp.push(new Array(availableHours + 1).fill(0));
  }

  for (let i = 1; i <= n; i++) {
    const item = vehicles[i - 1];
    const duration = item.Duration;
    const impact = item.Impact;
    for (let w = 0; w <= availableHours; w++) {
      if (duration <= w) {
        const valueWith = dp[i - 1][w - duration] + impact;
        const valueWithout = dp[i - 1][w];
        dp[i][w] = valueWith > valueWithout ? valueWith : valueWithout;
      } else {
        dp[i][w] = dp[i - 1][w];
      }
    }
  }

  const selected = [];
  let currentHours = availableHours;
  let timeUsed = 0;
  let score = dp[n][availableHours];

  for (let i = n; i > 0 && currentHours > 0; i--) {
    if (dp[i][currentHours] !== dp[i - 1][currentHours]) {
      const item = vehicles[i - 1];
      selected.push(item);
      currentHours -= item.Duration;
      timeUsed += item.Duration;
    }
  }

  selected.reverse();

  return {
    optimalTasks: selected,
    totalDuration: timeUsed,
    totalImpact: score
  };
}
