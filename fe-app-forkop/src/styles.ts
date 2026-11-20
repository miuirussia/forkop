// language=CSS
import { ComponentsTab } from './forkop/tabs/components';
import { DashboardTab } from './forkop/tabs/dashboard';
import { DiagnosticTab } from './forkop/tabs/diagnostic';
import { MonitoringTab } from './forkop/tabs/monitoring';
import { LogsTab } from './forkop/tabs/logs';
import { PartialStyles } from './partials';
import { FORKOP_UCI_PACKAGE as FORKOP_CBI_PREFIX } from './constants';
import { SPIN_PERIOD_MS } from './helpers/spinPhase';

export const GlobalStyles = `
${DashboardTab.styles}
${DiagnosticTab.styles}
${MonitoringTab.styles}
${LogsTab.styles}
${ComponentsTab.styles}
${PartialStyles}


/* The theme draws h2 small in its lowest text colour, nearly black on black in its dark variant. */
#cbi-${FORKOP_CBI_PREFIX} > h2 > small {
    color: var(--text-color-medium, #888);
    font-weight: normal;
}

/* The theme's flex layout overrides the browser's default [hidden] style. */
.modal .button-row[hidden] {
    display: none;
}

.cbi-dynlist.fkp-ruleset-list > .add-item {
    flex-wrap: nowrap;
    min-width: 0;
}

.cbi-dynlist.fkp-ruleset-list > .add-item > input.cbi-input-text {
    flex: 1 1 0;
    width: 0;
    min-width: 0;
}

.cbi-dynlist.fkp-ruleset-list > .add-item > .cbi-button-add {
    flex: 0 0 auto;
}

.cbi-dynlist.fkp-ruleset-list > .fkp-ruleset-picker {
    display: block;
    grid-column: 1 / -1;
    box-sizing: border-box;
    width: 100% !important;
    margin: 0;
}

.fkp-catalog {
    min-width: 0;
}

.fkp-catalog__status {
    margin: 0.5em 0 0.75em;
    font-variant-numeric: tabular-nums;
}

.fkp-catalog__list {
    --fkp-catalog-columns: minmax(0, 1fr) 7em;
    max-height: 45vh;
    overflow: auto;
    scrollbar-gutter: stable;
}

.fkp-catalog__list--counts {
    --fkp-catalog-columns: minmax(0, 1fr) 6ch 7em;
}

.fkp-catalog__row {
    display: grid;
    grid-template-columns: var(--fkp-catalog-columns);
    align-items: center;
    gap: 0.75em;
    padding: 0.5em 0.75em;
}

.fkp-catalog__row:nth-child(even) {
    background: color-mix(in srgb, currentColor 6%, transparent);
}

.fkp-catalog__row > .fkp-catalog__name {
    display: block;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    white-space: normal;
    overflow-wrap: anywhere;
}

.fkp-catalog__count {
    text-align: end;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.fkp-catalog__row > .fkp-catalog__action {
    box-sizing: border-box;
    width: 100% !important;
    min-width: 0;
    margin: 0;
    white-space: normal;
    overflow-wrap: anywhere;
}

.fkp-catalog__footer {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.5em;
    margin-top: 1em;
}

.fkp-catalog__footer > .cbi-button {
    margin: 0;
}

.fkp-settings {
    container: forkop-settings / inline-size;
}

.fkp-settings__layout > .cbi-tabmenu {
    display: flex;
    flex-wrap: wrap;
    margin-inline: 0;
    overflow: visible;
}

.fkp-settings__layout > .cbi-tabmenu > li {
    min-width: 0;
    max-width: 100%;
    height: auto;
}

.fkp-settings__layout > .cbi-tabmenu > li > a {
    white-space: normal;
    overflow-wrap: anywhere;
}

.fkp-settings__layout > .cbi-tabmenu > li.cbi-tab-disabled:not([data-errors], :hover) > a {
    color: var(--muted-foreground, inherit);
}

.fkp-settings__layout > .cbi-tabmenu > li.cbi-tab-disabled[data-errors]::after {
    content: attr(data-errors);
    box-sizing: border-box;
    display: inline-grid;
    place-items: center;
    flex: none;
    min-width: 1.25rem;
    height: 1.25rem;
    margin: 0;
    margin-inline-end: 0.375rem;
    padding: 0 0.25rem;
    border-radius: 1rem;
    background: #c43c35;
    color: #fff;
    font-size: 0.75rem;
    line-height: 1;
    vertical-align: middle;
}

.fkp-settings__layout > .cbi-section-node-tabbed {
    min-width: 0;
}

.fkp-settings__layout > .cbi-section-node-tabbed > [data-tab-active="false"] {
    display: none;
}

@container forkop-settings (min-width: 44rem) {
    .fkp-settings__layout {
        display: grid;
        grid-template-columns: 11.5rem minmax(0, 1fr);
        align-items: start;
        gap: 1rem;
    }

    #cbi-${FORKOP_CBI_PREFIX}-settings .fkp-settings__layout > .cbi-section-node.cbi-section-node-tabbed {
        margin-block-start: 0;
    }

    .fkp-settings__layout > .cbi-tabmenu {
        display: grid;
        gap: 0.25rem;
        margin: 0;
        padding: 0;
        border: 0;
        background: none;
    }

    .fkp-settings__layout > .cbi-tabmenu > li {
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 0.375rem;
        float: none;
    }

    .fkp-settings__layout > .cbi-tabmenu > li > a {
        box-sizing: border-box;
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: flex-start;
        min-height: 2.5rem;
        height: auto;
        padding: 0.5rem 0.75rem;
        margin: 0;
        border: 0;
        line-height: 1.3;
    }

    .fkp-settings__layout > .cbi-tabmenu > li.cbi-tab > a {
        font-weight: 600;
    }
}

#cbi-${FORKOP_CBI_PREFIX}-geodata {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
}

.fkp-geodata {
    display: grid;
    gap: 1.5rem;
    margin-block-end: 1rem;
}

.fkp-geodata > section {
    min-width: 0;
}

.fkp-geodata__heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin-block-end: 0.625rem;
}

.fkp-geodata__heading > h4 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
}

.fkp-geodata__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.fkp-geodata__actions:empty,
.fkp-geodata__actions > span:empty {
    display: none;
}

.fkp-geodata__actions .cbi-button {
    margin: 0;
}

.fkp-geodata__panel:has(> [data-name="_dat_sources"]) {
    padding: 0;
    border: 0;
    background: none;
}

.fkp-geodata__panel > [data-name="_dat_sources"] {
    margin: 0;
    padding: 0;
    border: 0;
}

.fkp-geodata__panel > .cbi-value-description {
    margin: 0.5rem 0 0;
    padding: 0;
    color: var(--text-color-medium, inherit);
    font-size: 0.875em;
}

#cbi-${FORKOP_CBI_PREFIX}-geodata > .cbi-section-create:empty {
    display: none;
}

#cbi-${FORKOP_CBI_PREFIX}-geodata .td[data-name="_state"] {
    min-width: 10rem;
    white-space: normal;
    overflow-wrap: anywhere;
}

#cbi-${FORKOP_CBI_PREFIX}-geodata .td.cbi-section-actions > div {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

#cbi-${FORKOP_CBI_PREFIX}-geodata .td .cbi-button {
    margin: 0;
}

.cbi-dropdown > ul > li.fkp-builtin-list-unavailable {
    flex-direction: column;
    align-items: stretch;
    gap: 0.2em;
    white-space: normal;
}

.cbi-dynlist .cbi-dropdown[open] > ul.dropdown > li[aria-disabled="true"] {
    color: var(--text-color-medium, #888);
    background: transparent;
    opacity: 1;
}

.cbi-dropdown > ul > li > .fkp-builtin-list-refusal {
    display: block;
    min-width: 0;
    color: inherit;
    font-size: 0.8em;
    line-height: 1.4;
    white-space: normal;
    overflow-wrap: anywhere;
}

.fkp_page-status {
    margin-left: 0.4em;
    white-space: nowrap;
}

.fkp_page-status__dot {
    display: inline-block;
    width: 0.55em;
    height: 0.55em;
    margin-right: 0.35em;
    border-radius: 50%;
    vertical-align: 0.1em;
}

.fkp_page-status--success .fkp_page-status__dot {
    background: var(--success-color-medium, green);
}

.fkp_page-status--error .fkp_page-status__dot {
    background: var(--error-color-medium, red);
}

.fkp_page-status--progress .fkp_page-status__dot {
    background: var(--warn-color-medium, #b8860b);
    animation: fkp_page-status-pulse 1.2s ease-in-out infinite;
}

@keyframes fkp_page-status-pulse {
    50% {
        opacity: 0.3;
    }
}

/* Hide extra H3 for settings tab */
#cbi-${FORKOP_CBI_PREFIX}-settings > h3 {
    display: none;
}

/* Hide extra H3 for rules tab */
#cbi-${FORKOP_CBI_PREFIX}-section > h3:nth-child(1) {
    display: none;
}

/* Rule reorder visuals */
#cbi-${FORKOP_CBI_PREFIX}-section {
    position: relative;
}

#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row {
    position: relative;
}

#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row.placeholder {
    opacity: 1;
}

#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row.placeholder em {
    font-style: italic;
}

#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row.drag-over-above::after,
#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row.drag-over-below::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    height: 2px;
    border-radius: 2px;
    background: var(--primary-color-high, #1976d2);
    pointer-events: none;
    z-index: 2;
}

#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row.drag-over-above::after {
    top: -1px;
}

#cbi-${FORKOP_CBI_PREFIX}-section .cbi-section-table-row.drag-over-below::after {
    bottom: -1px;
}

/* Centered class helper */
.centered {
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Spinners get an animation-delay that is a fraction of this period (helpers/spinPhase.ts). */
.rotate {
    animation: spin ${SPIN_PERIOD_MS}ms linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

/* Skeleton styles*/
.skeleton {
    background-color: var(--background-color-low, #e0e0e0);
    border-radius: 4px;
    position: relative;
    overflow: hidden;
}

.skeleton::after {
    content: '';
    position: absolute;
    top: 0;
    left: -150%;
    width: 150%;
    height: 100%;
    background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.4),
            transparent
    );
    animation: skeleton-shimmer 1.6s infinite;
}

@keyframes skeleton-shimmer {
    100% {
        left: 150%;
    }
}
/* Toast */
.fkp-field-error {
    color: var(--error-color-medium, #d32f2f);
    margin-block-start: 0.4em;
    line-height: 1.4;
    white-space: pre-line;
    overflow-wrap: anywhere;
}

.toast-container {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    z-index: 9999;
    font-family: system-ui, sans-serif;
}

.toast {
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.3s ease, transform 0.3s ease;
    padding: 10px 16px;
    border-radius: 6px;
    color: #fff;
    font-size: 14px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    min-width: 220px;
    max-width: 340px;
    text-align: center;
}

.toast-success {
    background-color: #28a745;
}

.toast-error {
    background-color: #dc3545;
}

.toast.visible {
    opacity: 1;
    transform: translateY(0);
}
`;
