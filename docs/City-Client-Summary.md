# City / Client Summary

Under **Ev Deployed source**, choose **EV91 API Data (NEW_RIDER + RE_JOINER)** to count deployment events whose reason is either `NEW_RIDER` or `RE_JOINER`. Counts follow the selected city and date range and the existing duplicate-event rules. Reason matching ignores casing, surrounding spaces, and underscore/hyphen separators. Bangalore and Bengaluru use the same city match.

The combined count appears in **Ev Deployed** for each client and in the total. **Total Deployed** adds this count to **IC Deployed**; **Net add on** subtracts **Return**. Both API options count returns with reason **Exiting** or **Shifting to Own Vehicle**. IC continues to count first order-upload days for NON-EV riders.

**Raw data**, **Export raw CSV**, **Export Summary**, and **Export All Cities** follow the selected option. Raw EV rows include the reason so the new rider and rejoiner events can be checked. The default **EV91 API Data** option continues to count `NEW_RIDER` only. **Current (Overall Status)** and **Order data (first EV day)** remain available.
