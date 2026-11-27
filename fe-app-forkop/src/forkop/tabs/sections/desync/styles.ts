export const DesyncStyles = `
.cbi-value-field > .fkp-desync,
.fkp-desync {
    display: block;
    box-sizing: border-box;
    flex: 1 1 100%;
    width: 100%;
    min-width: 0;
    max-width: 100%;
}

.fkp-desync [hidden] {
    display: none !important;
}

.fkp-desync__tabs > .cbi-tabmenu {
    display: flex;
    flex-wrap: wrap;
    margin: 0 0 24px;
    overflow: visible;
}

.fkp-desync__tabs > .cbi-tabmenu > li {
    min-width: 0;
    max-width: 100%;
}

.fkp-desync__tabs > .cbi-tabmenu > li > a {
    height: auto;
    min-height: 44px;
    white-space: normal;
    overflow-wrap: anywhere;
}

.fkp-desync__group {
    min-width: 0;
    margin: 24px 0;
}

.fkp-desync .fkp-desync__heading {
    margin: 0 0 12px;
    font-size: 1em;
    font-weight: 600;
    color: inherit;
}

.fkp-desync .fkp-desync__panel {
    display: block;
    width: 100%;
    min-width: 0;
    margin: 0;
    border: 0;
    border-top: 1px solid var(--border-color-low, #8886);
    border-radius: 0;
    padding: 0;
}

.fkp-desync .fkp-desync__panel > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    box-sizing: border-box;
    min-height: 44px;
    padding: 12px 4px;
    cursor: pointer;
    font-weight: 600;
    white-space: normal;
    overflow-wrap: anywhere;
}

.fkp-desync__panel > summary::marker {
    content: '';
}

.fkp-desync__panel > summary::-webkit-details-marker {
    display: none;
}

.fkp-desync__title {
    min-width: 0;
}

.fkp-desync .fkp-desync__toggle {
    flex: 0 0 auto;
    min-width: 6em;
    margin: 0;
    pointer-events: none;
    text-align: center;
    font-weight: normal;
}

.fkp-desync__panel > summary .fkp-desync__hide,
.fkp-desync__panel[open] > summary .fkp-desync__show {
    display: none;
}

.fkp-desync__panel[open] > summary .fkp-desync__hide {
    display: inline;
}

.fkp-desync .fkp-desync__panel > summary:focus-visible {
    outline: 2px solid var(--primary-color-medium, #0075db);
    outline-offset: -2px;
}

.fkp-desync__body {
    display: block;
    min-width: 0;
    padding: 0;
}

.fkp-desync__fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    align-items: start;
    gap: 16px 24px;
}

.fkp-desync .fkp-desync__field {
    display: grid;
    gap: 6px;
    min-width: 0;
    margin: 0;
    white-space: normal;
}

.fkp-desync__preset {
    max-width: 26rem;
}

.fkp-desync .fkp-desync__field > :is(input, select, textarea),
.fkp-desync__body > textarea {
    box-sizing: border-box;
    width: 100% !important;
    min-width: 0;
    max-width: 100%;
}

.fkp-desync .fkp-desync__field > select {
    white-space: nowrap;
    text-overflow: ellipsis;
}

.fkp-desync textarea {
    resize: vertical;
}

.fkp-desync p {
    margin: 0 0 16px;
    line-height: 1.5;
    overflow-wrap: anywhere;
}

.fkp-desync__fields + p {
    margin-top: 16px;
}

.fkp-desync__fields + .fkp-desync__field {
    margin-top: 16px;
}

.fkp-desync small {
    line-height: 1.4;
    overflow-wrap: anywhere;
}

.fkp-desync .fkp-desync__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 16px 0;
}

.fkp-desync__actions > .cbi-button {
    min-height: 44px;
    max-width: 100%;
    margin: 0;
    white-space: normal;
}

.fkp-desync .fkp-desync__error,
.fkp-desync .fkp-desync__failure {
    color: var(--error-color-high, #b42318);
    color: light-dark(#b42318, #ff8a80);
}

.fkp-desync .fkp-desync__error:empty,
.fkp-desync [role="status"]:empty {
    display: none;
}

.fkp-desync .fkp-desync__field > [aria-invalid="true"] {
    border-color: var(--error-color-high, #b42318);
    border-color: light-dark(#b42318, #ff8a80);
    outline-color: var(--error-color-high, #b42318);
    outline-color: light-dark(#b42318, #ff8a80);
}

.fkp-desync .fkp-desync__result-list {
    display: grid;
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.fkp-desync .fkp-desync__result {
    min-width: 0;
    margin: 0;
    padding: 16px;
    border: 1px solid var(--border-color-low, #8886);
    border-radius: 8px;
    list-style: none;
}

.fkp-desync .fkp-desync__result-title {
    margin: 0 0 16px;
    font-size: 1em;
    font-weight: 600;
    color: inherit;
    overflow-wrap: anywhere;
}

.fkp-desync .fkp-desync__metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
    gap: 16px 24px;
    margin: 0 0 16px;
}

.fkp-desync__metrics > div {
    min-width: 0;
}

.fkp-desync .fkp-desync__metrics dt {
    margin: 0 0 4px;
    font-size: 0.875em;
    font-weight: normal;
}

.fkp-desync .fkp-desync__metrics dd {
    margin: 0;
    overflow-wrap: anywhere;
}

.fkp-desync .fkp-desync__result-json {
    box-sizing: border-box;
    max-width: 100%;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.fkp-desync__result > .fkp-desync__actions {
    margin-bottom: 0;
}
`;
