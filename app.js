const BASE_DATA_URL = "../forms/"; // Same-origin only: blocked from arbitrary external fetches by CSP.
    
    // Friendly document titles used in generated filenames
    const documentTitles = {
        'Application-to-Transfer-Existing-Insurance-cover-transfer-form.pdf': 'Transfer Existing Insurance',
        'Change-Details-Form.pdf': 'Change of Details',
        'Change-Occupation-Form.pdf': 'Change Occupation Category',
        'App-Increase-Cover-Living-Events.pdf': 'Life Event Insurance Change',
        'Application-Apply-IP-Cover-Industry.pdf': 'Apply for Income Protection Cover',
        'Salary-Sacrifice-Form.pdf': 'Salary Sacrifice Authority',
        'Cbus-how-to-claim-tax-deduction-super-contributions.pdf': 'Notice of Intent to Claim Tax Deduction',
        'Kiwi-Saver-Form.pdf': 'KiwiSaver Transfer Form',
        'Compassionate-Grounds-form.pdf': 'Compassionate Grounds Withdrawal',
        'General-Statutory-Declaration.pdf': 'General Statutory Declaration',
        'join-industry-form.pdf': 'Join Cbus Industry Super',
        'Change-Insurance-Form-Industry-Super.pdf': 'Change My Insurance (Industry Super)',
        'Binding-Death-Benefit-Nomination-Form.pdf': 'Binding Death Benefit Nomination',
        'Combine-Form.pdf': 'Combine Your Super into Cbus',
        'super-withdrawal-form.pdf': 'Withdraw Your Super',
        'I-want-my-super-paid-into-Cbus.pdf': 'Pay My Super Into Cbus (Employer Choice)',
        'corporate-super-set-up.pdf': 'Set Up Corporate Super Account',
        'join-sole-trader.pdf': 'Join Cbus Sole Trader Super',

        'ttr-sis-pds.pdf': 'Transition to Retirement PDS',
        'cbus-super-income-stream-join-form.pdf': 'Join Cbus Super Income Stream',
        'Change-Income-Stream-Details-Form.pdf': 'Change Your Income Stream Details',
        'fr-sis-pds.pdf': 'Fully Retired PDS',
        'SIS-Binding-Death-Nomination-Form.pdf': 'SIS Binding Death Benefit Nomination',
        'SIS-Switching-Form.pdf': 'Investment Choice Form (Income Stream)',
        'SIS-Withdrawal-Form.pdf': 'Income Stream Withdrawal or Rollover',
        'Third-Party-Authority-Form.pdf': 'Third Party Authority'
    };
    
    // Toggle panel view helper
    function switchInputMode(mode) {
        const manualBtn = document.getElementById('mode-manual');
        const importBtn = document.getElementById('mode-import');
        const importPanel = document.getElementById('import-panel');
        
        if (mode === 'manual') {
            manualBtn.classList.add('active');
            importBtn.classList.remove('active');
            importPanel.style.display = 'none';
        } else {
            importBtn.classList.add('active');
            manualBtn.classList.remove('active');
            importPanel.style.display = 'block';
        }
    }

    // ---------- Salesforce paste parser (privacy-safe: no network calls) ----------
    // Parser revision: v4-collapsed-address-boundary
    // PDF checkbox revision: v7-acrobat-disable-needappearances
    const SALESFORCE_FIELD_BOUNDARY = [
        'Account Name', 'Preferred Name', 'Member Segment', 'Brand Identifier', 'Brand',
        'Account Owner', 'Member Account Number', 'Member Number', 'Birthdate', 'Age',
        'Date of Death', 'Gender', 'Email Opt Out', 'Direct Mail Opt Out', 'Email',
        'Phone', 'Mobile', 'Occupation Code', 'Occupation Code 2',
        'Referred to Cbus / IA Practice', 'Registered Address', 'Residential Address',
        'Postal Address'
    ];

    function normalizeSalesforceText(text) {
        return String(text || '')
            .replace(/\r\n?/g, '\n')
            .replace(/[\u00A0\u2007\u202F]/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .trim();
    }

    function setValue(id, value) {
        if (value === undefined || value === null) return false;
        const clean = String(value).trim();
        if (!clean) return false;
        const el = document.getElementById(id);
        if (!el) return false;
        el.value = clean;
        return true;
    }

    function normalizeAuPhone(value, kind) {
        let digits = String(value || '').replace(/\D/g, '');
        if (digits.startsWith('61') && (digits.length === 11 || digits.length === 10)) {
            digits = '0' + digits.slice(2);
        }
        if (kind === 'mobile') return /^04\d{8}$/.test(digits) ? digits : '';
        if (kind === 'landline') return /^0[2378]\d{8}$/.test(digits) ? digits : '';
        return digits;
    }

    function parseDobToIso(value) {
        const m = String(value || '').match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
        if (!m) return '';
        const day = Number(m[1]);
        const month = Number(m[2]);
        const year = Number(m[3]);
        const dt = new Date(year, month - 1, day);
        // Reject rollovers such as 31/02/1989 rather than silently changing the date.
        if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return '';
        return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }

    function cleanAddressText(value) {
        return String(value || '')
            .replace(/\bAUSTRALIA\b/ig, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Resolves common Australian street / suburb / state / postcode structures.
    function parseAddressBlock(blockText) {
        if (!blockText) return null;

        // Keep Salesforce line breaks for as long as possible. In the Salesforce UI the
        // street is commonly on one line and suburb/state/postcode on the next.
        const lines = String(blockText)
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map(v => cleanAddressText(v))
            .filter(Boolean);

        const normalizedBlock = cleanAddressText(blockText);
        if (!normalizedBlock) return null;

        let state = '';
        let postcode = '';
        let suburb = '';
        let streetAddr = '';

        // First preference: preserve the line structure Salesforce gives us.
        // Example:
        //   12 Example Street
        //   Brisbane QLD 4000
        if (lines.length >= 2) {
            const last = lines[lines.length - 1];
            const locality = last.match(/^(.*?)\s+\b(QLD|NSW|VIC|WA|SA|TAS|ACT|NT)\s+(\d{4})\b$/i);
            if (locality) {
                suburb = locality[1].trim();
                state = locality[2].toUpperCase();
                postcode = locality[3];
                streetAddr = lines.slice(0, -1).join(' ').trim();
                if (streetAddr && suburb) return { streetAddr, suburb, state, postcode };
            }
        }

        // Otherwise parse the flattened one-line form. Anchor state/postcode at the end
        // and then split the street from the suburb using a broad Australian street-type list.
        let beforeState = normalizedBlock;
        const statePostcodeMatch = normalizedBlock.match(/\b(QLD|NSW|VIC|WA|SA|TAS|ACT|NT)\s+(\d{4})\b/i);
        if (statePostcodeMatch) {
            state = statePostcodeMatch[1].toUpperCase();
            postcode = statePostcodeMatch[2];
            beforeState = normalizedBlock.slice(0, statePostcodeMatch.index).trim();
        }

        const poBoxMatch = beforeState.match(/^(P\s*\.?O\s*\.?\s*Box|GPO\s*Box|Locked\s*Bag|Private\s*Bag)\s+([A-Z0-9-]+)\b/i);
        if (poBoxMatch) {
            const end = poBoxMatch[0].length;
            streetAddr = beforeState.slice(0, end).trim();
            suburb = beforeState.slice(end).trim();
            return { streetAddr, suburb, state, postcode };
        }

        // Salesforce can remove every separator from copied rich-text addresses, e.g.
        // "78 Randall RoadWYNNUM WEST QLD 4178". So the street suffix may be
        // immediately followed by the first capital of the suburb.
        const streetTypes = 'Alley|Ally|Arcade|Arc|Avenue|Ave|Boulevard|Bvd|Blvd|Brace|Br|Bypass|Bypa|Causeway|Cswy|Circuit|Cct|Close|Cl|Concourse|Con|Court|Ct|Crescent|Cres|Crest|Crst|Drive|Dr|Entrance|Ent|Esplanade|Esp|Expressway|Exp|Freeway|Fwy|Glade|Glde|Glen|Gln|Grove|Gr|Highway|Hwy|Lane|Ln|Link|Lk|Loop|Mall|Mews|Motorway|Mwy|Parade|Pde|Parkway|Pkwy|Passage|Psge|Place|Pl|Promenade|Prom|Quay|Qy|Ramble|Retreat|Rtt|Ridge|Rdge|Rise|Road|Rd|Square|Sq|Street|St|Terrace|Tce|Track|Trk|Trail|Trl|View|Vw|Walk|Way|Wharf|Whrf';

        let suffixMatch = beforeState.match(new RegExp('\\\\b(' + streetTypes + ')\\\\b', 'i'));

        // Collapsed Salesforce form: recognised street type directly followed by suburb.
        if (!suffixMatch) {
            suffixMatch = beforeState.match(new RegExp('\\\\b(' + streetTypes + ')(?=[A-Z])'));
        }

        if (suffixMatch) {
            const end = suffixMatch.index + suffixMatch[0].length;
            streetAddr = beforeState.slice(0, end).trim();
            suburb = beforeState.slice(end).trim();
        } else if (lines.length >= 2) {
            // Line-based fallback for unusual street types.
            streetAddr = lines[0];
            suburb = lines.slice(1).join(' ')
                .replace(/\b(QLD|NSW|VIC|WA|SA|TAS|ACT|NT)\s+\d{4}\b/i, '')
                .trim();
        } else {
            // Do not invent a suburb boundary when Salesforce supplied an unknown one-line
            // address. Keep the address intact rather than putting text in the wrong fields.
            streetAddr = beforeState;
        }

        return { streetAddr, suburb, state, postcode };
    }

    function extractAddressSection(text, label, nextLabels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
        const next = nextLabels.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')).join('|');
        const re = new RegExp(escaped + '\\s*[:\\-]?\\s*([\\s\\S]*?)(?=' + next + '|$)', 'i');
        const m = text.match(re);
        return m ? m[1].trim() : '';
    }

    function parsePastedText() {
        const rawText = normalizeSalesforceText(document.getElementById('paste-box').value || '');
        if (!rawText) return;

        const parsed = new Set();
        const warnings = [];
        const mark = (id, value) => { if (setValue(id, value)) parsed.add(id); };

        // Account Name contains the Salesforce title. Capture it instead of discarding it.
        const nameMatch = rawText.match(/Account\s*Name\s*[:\-]?\s*((?:(?:Mr|Mrs|Miss|Ms|Other)\.?\s+)?[\s\S]*?)(?=\s*(?:Preferred\s*Name|Member\s*Segment|Brand(?:\s*Identifier)?|Account\s*Owner|Member\s*Account\s*Number|Birthdate|Age|Date\s*of\s*Death|Gender|Email|Phone|Mobile|Occupation\s*Code|Registered\s*Address|Postal\s*Address|$))/i);
        if (nameMatch) {
            let fullName = nameMatch[1].replace(/\s+/g, ' ').trim();
            const titleMatch = fullName.match(/^(Mr|Mrs|Miss|Ms|Other)\.?\b/i);
            if (titleMatch) {
                const title = titleMatch[1].replace(/^mr$/i, 'Mr').replace(/^mrs$/i, 'Mrs').replace(/^miss$/i, 'Miss').replace(/^ms$/i, 'Ms').replace(/^other$/i, 'Other');
                mark('title', title);
                fullName = fullName.slice(titleMatch[0].length).trim();
            }
            const parts = fullName.split(/\s+/).filter(Boolean);
            if (parts.length > 1) {
                mark('fn', parts.pop());
                mark('gn', parts.join(' '));
            } else if (parts.length === 1) {
                mark('gn', parts[0]);
            }
        }

        const genderMatch = rawText.match(/Gender\s*[:\-]?\s*(Male|Female)(?=\s*(?:Email\s*Opt\s*Out|Direct\s*Mail\s*Opt\s*out|Brand|Account|Member|Registered\s*Address|Postal\s*Address|Occupation\s*Code|$))/i);
        if (genderMatch) mark('gender', /^male$/i.test(genderMatch[1]) ? 'Male' : 'Female');

        const memberNoMatch = rawText.match(/(?:Member\s*Account\s*Number|Member\s*Number)\s*[:\-]?\s*(\d{5,15})/i);
        if (memberNoMatch) mark('m_no', memberNoMatch[1]);

        const birthdateMatch = rawText.match(/(?:Birthdate|Date\s*of\s*Birth)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i);
        if (birthdateMatch) {
            const iso = parseDobToIso(birthdateMatch[1]);
            if (iso) mark('dob', iso); else warnings.push('DOB looked invalid and was not populated');
        }

        // Lazy domain match + Salesforce field-boundary lookahead prevents hotmail.comAge-style bleed.
        const emailMatch = rawText.match(/Email\s*[:\-]?\s*([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,24}?)(?=\s*(?:Age|Mobile|Phone|Home\s*Phone|Registered\s*Address|Residential\s*Address|Postal\s*Address|Tax\s*File\s*Number|TFN|Member|Brand|Preferred|Account|$))/i);
        if (emailMatch) mark('eml', emailMatch[1]);
        else {
            const standaloneEmail = rawText.match(/\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,24}\b/i);
            if (standaloneEmail) mark('eml', standaloneEmail[0]);
        }

        const mobileLabel = rawText.match(/Mobile(?:\s*Phone)?\s*[:\-]?\s*((?:\+?61|0)?[\d ()\-]{8,16})/i);
        if (mobileLabel) {
            const mobile = normalizeAuPhone(mobileLabel[1], 'mobile');
            if (mobile) mark('mob', mobile);
        }
        if (!document.getElementById('mob').value) {
            const m = rawText.match(/(?:\+?61[\s()-]*4|04)[\s()\-]*\d{2}[\s()\-]*\d{3}[\s()\-]*\d{3}/);
            if (m) mark('mob', normalizeAuPhone(m[0], 'mobile'));
        }

        const homeLabel = rawText.match(/(?:Home\s*Phone|Telephone\s*Home|Phone)\s*[:\-]?\s*((?:\+?61|0)?[\d ()\-]{8,16})/i);
        if (homeLabel) {
            const home = normalizeAuPhone(homeLabel[1], 'landline');
            if (home) mark('tel_home', home);
        }

        // TFN is manual-entry only. Salesforce pasted data never populates it.

        const regBlock = extractAddressSection(rawText, 'Registered Address', ['Postal Address', 'Email', 'Phone', 'Mobile', 'Occupation Code', 'Occupation Code 2']);
        const residentialBlock = regBlock || extractAddressSection(rawText, 'Residential Address', ['Postal Address', 'Email', 'Phone', 'Mobile', 'Occupation Code', 'Occupation Code 2']);
        if (residentialBlock) {
            const p = parseAddressBlock(residentialBlock);
            if (p) {
                mark('addr', p.streetAddr); mark('sub', p.suburb); mark('pc', p.postcode);
                if (p.state) { document.getElementById('st').value = p.state; parsed.add('st'); }
            }
        }

        const postalBlock = extractAddressSection(rawText, 'Postal Address', ['Email', 'Phone', 'Mobile', 'Occupation Code', 'Occupation Code 2']);
        if (postalBlock) {
            const p = parseAddressBlock(postalBlock);
            if (p) {
                mark('postal_addr', p.streetAddr); mark('postal_sub', p.suburb); mark('postal_pc', p.postcode);
                if (p.state) { document.getElementById('postal_st').value = p.state; parsed.add('postal_st'); }
            }
        }

        const status = document.getElementById('status');
        const friendly = {
            m_no:'member number', title:'title', gender:'gender', gn:'given name', fn:'family name', dob:'DOB', tfn:'TFN', mob:'mobile', tel_home:'home phone', eml:'email',
            addr:'residential address', sub:'residential suburb', st:'residential state', pc:'residential postcode',
            postal_addr:'postal address', postal_sub:'postal suburb', postal_st:'postal state', postal_pc:'postal postcode'
        };
        const found = Array.from(parsed).map(id => friendly[id] || id);
        status.style.color = warnings.length ? '#9a6700' : 'var(--cbus)';
        status.innerText = `Parsed ${found.length} fields${warnings.length ? ' — ' + warnings.join('; ') : '. Please review before generating.'}`;
    }

    function clearAllFields() {
        const fieldsToClear = ['m_no', 'title', 'gender', 'gn', 'fn', 'dob', 'tfn', 'mob', 'tel_home', 'eml', 'addr', 'sub', 'pc', 'postal_addr', 'postal_sub', 'postal_pc'];
        fieldsToClear.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        
        const st = document.getElementById('st');
        if (st) st.selectedIndex = 0;
        
        const postalSt = document.getElementById('postal_st');
        if (postalSt) postalSt.selectedIndex = 0;
        
        const checkboxes = document.querySelectorAll('#formList input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = false);
        
        const status = document.getElementById('status');
        if (status) {
            status.style.color = "var(--cbus)";
            status.innerText = "Ready.";
        }
        
        const pasteBox = document.getElementById('paste-box');
        if (pasteBox) pasteBox.value = "";
        
        const diagBox = document.getElementById('diagnostic-box');
        if (diagBox) {
            diagBox.style.display = "none";
            diagBox.innerHTML = "";
        }
    }

    // Cbus uses one PDF button field with multiple widgets for Title/Gender.
    // pdf-lib's ordinary PDFCheckBox.check() only targets the field's default on-value,
    // so select the matching widget export value explicitly (e.g. Mr, Female).
    function selectWidgetChoice(field, wantedValue) {
        if (!field || !wantedValue || !(field instanceof PDFLib.PDFCheckBox)) return false;

        const wanted = String(wantedValue).trim().toLowerCase();

        try {
            const widgets = field.acroField.getWidgets();
            let selectedName = null;

            // Find the widget whose actual PDF appearance/export value is the requested
            // choice (Mr/Mrs/Miss/Ms/Other or Male/Female).
            for (const widget of widgets) {
                const onValue = widget.getOnValue();
                const onText = onValue ? onValue.decodeText() : '';

                if (onText.trim().toLowerCase() === wanted) {
                    selectedName = onValue;
                    break;
                }
            }

            if (!selectedName) {
                console.warn(`No PDF widget value matched "${wantedValue}" for "${field.getName()}"`);
                return false;
            }

            const offName = PDFLib.PDFName.of('Off');
            const asKey = PDFLib.PDFName.of('AS');
            const valueKey = PDFLib.PDFName.of('V');

            // Set every child annotation explicitly.  This bypasses pdf-lib's normal
            // single-checkbox assumptions, which do not reliably preserve a choice when
            // multiple checkbox widgets share one parent field.
            for (const widget of widgets) {
                const onValue = widget.getOnValue();
                const onText = onValue ? onValue.decodeText() : '';
                const state = onText.trim().toLowerCase() === wanted ? onValue : offName;

                // High-level setter plus direct annotation dictionary assignment.
                try { widget.setAppearanceState(state); } catch (_) {}
                try { widget.dict.set(asKey, state); } catch (_) {}
            }

            // Set the parent field value directly as well as through pdf-lib.
            try { field.acroField.setValue(selectedName); } catch (_) {}
            try { field.acroField.dict.set(valueKey, selectedName); } catch (_) {}

            return true;
        } catch (e) {
            console.warn(`Could not select ${wantedValue} in ${field.getName()}`, e);
            return false;
        }
    }

    async function runBatchProcessing() {
        const status = document.getElementById('status');
        const diagBox = document.getElementById('diagnostic-box');
        status.style.color = "var(--cbus)";
        status.innerText = "🔄 Starting engine...";
        diagBox.style.display = "none";
        diagBox.innerHTML = "";

        try {
            const selected = Array.from(document.querySelectorAll('#formList input:checked'));
            if (selected.length === 0) {
                status.innerText = "Ready.";
                return alert("Please select at least one form to generate.");
            }

            // Retrieve and prepare form variables
            const title = (document.getElementById('title').value || "").trim();
            const gender = (document.getElementById('gender').value || "").trim();
            const gn = (document.getElementById('gn').value || "").trim();
            const fn = (document.getElementById('fn').value || "").trim();
            const fullNamePrefix = `${gn} ${fn}`.trim() || "Member_Form";

            // Parse Date of Birth with fallback for browser discrepancy
            const dobVal = document.getElementById('dob').value || "";
            let y = "", m = "", d = "";
            if (dobVal) {
                if (dobVal.includes('-')) {
                    const parts = dobVal.split('-');
                    y = parts[0]; m = parts[1]; d = parts[2];
                } else if (dobVal.includes('/')) {
                    const parts = dobVal.split('/');
                    if (parts[0].length === 4) {
                        y = parts[0]; m = parts[1]; d = parts[2];
                    } else {
                        d = parts[0]; m = parts[1]; y = parts[2];
                    }
                }
            }

            const tfn = (document.getElementById('tfn').value || "").replace(/\s/g, '');
            const mNo = (document.getElementById('m_no').value || "").trim();
            const mob = (document.getElementById('mob').value || "").trim();
            const eml = (document.getElementById('eml').value || "").trim();
            const addr = (document.getElementById('addr').value || "").trim();
            const sub = (document.getElementById('sub').value || "").trim();
            const st = document.getElementById('st').value;
            const pc = (document.getElementById('pc').value || "").trim();
            const telHome = (document.getElementById('tel_home').value || "").trim();

            let postalAddr = (document.getElementById('postal_addr').value || "").trim();
            let postalSub = (document.getElementById('postal_sub').value || "").trim();
            let postalSt = document.getElementById('postal_st').value; 
            let postalPc = (document.getElementById('postal_pc').value || "").trim();

            // Populate postal details from residential address if empty/defaulted
            if (!postalAddr) {
                postalAddr = addr;
                postalSub = sub;
                postalSt = st;
                postalPc = pc;
            }
            if (!postalSt) {
                postalSt = st;
            }

            // Segment Home Phone into: Area Code (2 digits), Prefix (4 digits), Suffix (4 digits)
            const cleanHome = telHome.replace(/[^0-9]/g, '');
            let homeArea = "", homePrefix = "", homeSuffix = "";
            if (cleanHome.length === 10) {
                homeArea = cleanHome.substring(0, 2);
                homePrefix = cleanHome.substring(2, 6);
                homeSuffix = cleanHome.substring(6, 10);
            } else if (cleanHome.length === 8) {
                homePrefix = cleanHome.substring(0, 4);
                homeSuffix = cleanHome.substring(4, 8);
            } else {
                homeArea = cleanHome.substring(0, 2);
                homePrefix = cleanHome.substring(2, 6);
                homeSuffix = cleanHome.substring(6);
            }

            // Segment Mobile Phone into: Prefix (4 digits), Segment 1 (3 digits), Segment 2 (3 digits)
            const cleanMob = mob.replace(/[^0-9]/g, '');
            let mobArea = "", mobPrefix = "", mobSuffix = "";
            if (cleanMob.length === 10) {
                mobArea = cleanMob.substring(0, 4);
                mobPrefix = cleanMob.substring(4, 7);
                mobSuffix = cleanMob.substring(7, 10);
            } else {
                mobArea = cleanMob.substring(0, 4);
                mobPrefix = cleanMob.substring(4, 7);
                mobSuffix = cleanMob.substring(7);
            }

            const now = new Date();
            const curD = String(now.getDate()).padStart(2, '0');
            const curM = String(now.getMonth() + 1).padStart(2, '0');
            const curYYYY = String(now.getFullYear());
            const curYY = curYYYY.substring(2);
            
            // Format Day with suffix (e.g., "24th")
            const getDaySuffix = (day) => {
                let suffix = 'th';
                if (day === 1 || day === 21 || day === 31) suffix = 'st';
                else if (day === 2 || day === 22) suffix = 'nd';
                else if (day === 3 || day === 23) suffix = 'rd';
                return `${day}${suffix}`;
            };
            const curDayWithSuffix = getDaySuffix(now.getDate());

            // Format Month and Year as full text (e.g. "June 2026")
            const curMonthAndYear = now.toLocaleString('en-AU', { month: 'long', year: 'numeric' });

            // Split Residential Address into Street Number and Street Name (with fallback to full address)
            let resNum = addr, resName = addr;
            if (addr.includes(' ')) {
                const spaceIndex = addr.indexOf(' ');
                resNum = addr.substring(0, spaceIndex).trim();
                resName = addr.substring(spaceIndex + 1).trim();
            }

            // Split Postal Address into Street Number and Street Name (with fallback to full address)
            let postNum = postalAddr, postName = postalAddr;
            if (postalAddr.includes(' ')) {
                const spaceIndex = postalAddr.indexOf(' ');
                postNum = postalAddr.substring(0, spaceIndex).trim();
                postName = postalAddr.substring(spaceIndex + 1).trim();
            }

            // Normalization helper for case-insensitive/whitespace-insensitive field mapping
            const getCleanKey = (str) => {
                if (!str) return '';
                return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
            };

            // Container for strict, form-isolated exact mappings
            const formSpecificMaps = {
                // 1. Binding Death Benefit Nomination (Accumulation)
                'Binding-Death-Benefit-Nomination-Form.pdf': {
                    'Cbus member number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile': mob,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Email address': eml,

                    'Step 3 date': curD,
                    'Step 3 date MM': curM,
                    'Step 3 date YY': curYY,

                    '3 Step 3 date': curD,
                    '3 Step 3 date MM': curM,
                    '3 Step 3 date YY': curYY,

                    '4 Step 3 date': curD,
                    '4 Step 3 date MM': curM,
                    '4 Step 3 date YY': curYY
                },

                // 2. Salary Sacrifice Form
                'Salary-Sacrifice-Form.pdf': {
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Given names': gn,
                    'Family name': fn,
                    'Residential address': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Postal address if different': postalAddr,
                    'Suburb/town 2': postalSub,
                    'State 2': postalSt,
                    'Postcode 2': postalPc,
                    'Cbus member number': mNo,

                    'Member declaration date DD': curD,
                    'Member declaration date MM': curM,
                    'Member declaration date YY': curYY
                },

                // 3. SIS Binding Death Benefit Nomination (Income Stream)
                'SIS-Binding-Death-Nomination-Form.pdf': {
                    'Cbus member number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile': mob,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'postal Street Name': postalAddr,
                    'postal Suburb/town': postalSub,
                    'postal State': postalSt,
                    'postal Postcode': postalPc,
                    'Email address': eml,

                    'Sign day binding': curD,
                    'Sign month binding': curM,
                    'Sign year binding': curYY,

                    'Witness 1 date day': curD,
                    'Witness 1 date month': curM,
                    'Witness 1 date year': curYY,

                    'Witness 2 date day': curD,
                    'Witness 2 date year': curYY
                },

                // 4. Change of details Form
                'Change-Details-Form.pdf': {
                    'Cbus Super member number': mNo,
                    'Cbus member number': mNo,
                    'Member number': mNo,
                    'MEMBER number': mNo,
                    'Given names': gn,
                    'Given name(s)': gn,
                    'First names': gn,
                    'Family name': fn,
                    'Last name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Date of Birth DD': d,
                    'Date of Birth MM': m,
                    'Date of Birth YY': y,
                    'Residential address': addr,
                    'Street Name': addr,
                    'Street name': addr,
                    'Street Number': addr,
                    'Street Number and Name': addr,
                    'Street number and name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Postal address': postalAddr,
                    'Postal address if different': postalAddr,
                    'Street Number 2': postalAddr,
                    'Postal address street': postalAddr,
                    'Street number and name postal': postalAddr,
                    'Posal - Street name': postalAddr,
                    'Suburb/town 2': postalSub,
                    'State 2': postalSt,
                    'Postcode 2': postalPc,
                    'Posal - Suburb': postalSub,
                    'Posal - State': postalSt,
                    'Postcode - Posal': postalPc,
                    'Email address': eml,
                    'Email Address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile1': mob,
                    'mobile': mob,
                    'Mobile': mob,
                    'TFN': tfn,
                    'Tax file number': tfn,
                    'TFN1': tfn.substring(0, 3),
                    'TFN2': tfn.substring(3, 6),
                    'TFN3': tfn.substring(6, 9),
                    
                    'residential address': addr,
                    'Step 2 - resid suburb/town': sub,
                    'Step 2 - resid state': st,
                    'Step 2 - resid postcode': pc,
                    
                    'Step 2 - postal addr': postalAddr,
                    'Step 2 - postal suburb/town': postalSub,
                    'Step 2 - postal state': postalSt,
                    'Step 2 - postal postcode': postalPc,
                    
                    'Step 2 - email address': eml,
                    
                    'step 2 - Telephone home': homeArea,
                    'step 2 - Telephone home1': homePrefix,
                    'step 2 - Telephone home2': homeSuffix,
                    
                    'step 2 - Telephone mobile': mobArea,
                    'step 2 - Telephone mobile1': mobPrefix,
                    'step 2 - Telephone mobile2': mobSuffix,
                    
                    '2B - First names': gn,
                    '2B - Family name': fn,
                    '2B - Date of birth day': d,
                    '2B - Date of birth month': m,
                    '2B - Date of birth year': y,

                    'Step 4 - DD': curD,
                    'Step 4 - MM': curM,
                    'Step 4 - YYYY': curYY,
                    'Step 4 - YY': curYY,
                    'decDD': curD,
                    'decMM': curM,
                    'decYY': curYY
                },

                // 5. Change Occupation Category Form
                'Change-Occupation-Form.pdf': {
                    'Cbus member number': mNo,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Given names': gn,
                    'Family name': fn,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile1': mob,
                    'Email address': eml,
                    'Street Number': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Postal Address if different': postalAddr,
                    'Suburb/town 2': postalSub,
                    'State 2': postalSt,
                    'Postcode 2': postalPc,

                    'decDD': curD,
                    'decMM': curM,
                    'decYYYY': curYY
                },

                // 6. Compassionate Grounds Benefit Payment Application
                'Compassionate-Grounds-form.pdf': {
                    'Cbus member number': mNo,
                    'First names': gn,
                    'Last name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Street Name Postal': postalAddr,
                    'Suburb/town Postal': postalSub,
                    'State Postal': postalSt,
                    'Postcode Postal': postalPc,
                    'Email address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile1': mob,
                    'TFN': tfn.substring(0, 3), 
                    'TFN1': tfn.substring(3, 6),
                    'TFN2': tfn.substring(6, 9),
                    'Declaration Day': curD,
                    'Declaration Month': curM,
                    'Declaration year': curYY
                },

                // 7. KiwiSaver Transfer Form
                'Kiwi-Saver-Form.pdf': {
                    'Given names': gn,
                    'Family names': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'TFN': tfn,
                    'TFN1': tfn.substring(0, 3), 
                    'TFN2': tfn.substring(3, 6),
                    'TFN3': tfn.substring(6, 9),
                    'New Zealand Phone1': mob,
                    'Last known address in Australia': addr,
                    'Last known address in Australia Suburb': sub,
                    'State in Australia': st,
                    'Postcode in Australia': pc,
                    'Cbus Member Number': mNo,
                    'Declaration Day': curD,
                    'Declaration Month': curM,
                    'Declaration year': curYY,
                    'Signatory name': `${gn} ${fn}`.trim()
                },

                // 8. General Statutory Declaration
                'General-Statutory-Declaration.pdf': {
                    'Provide your name': `${gn} ${fn}`.trim(),
                    'Provide your occupation': '',
                    'Provide your address': `${addr}, ${sub}`.trim(),
                    'Provide your state or territory': `${st} ${pc}`.trim(),
                    
                    'Declaration day': `${sub}, ${st}`.trim(),       
                    'Declaration month': curDayWithSuffix,          
                    'Declaration year': curMonthAndYear             
                },

                // 9. Apply for Income Protection Cover
                'Application-Apply-IP-Cover-Industry.pdf': {
                    'Join Cbus Member Number': mNo,
                    'Given name(s)': gn,
                    'Family name': fn,
                    'Date of Birth DD': d,
                    'Date of Birth MM': m,
                    'Date of Birth YY': y, 
                    'Street name': addr,
                    'Suburb': sub,
                    'State': st,
                    'Postcode': pc,
                    'Posal - Street name': postalAddr,
                    'Posal - Suburb': postalSub,
                    'Posal - State': postalSt,
                    'Posal - Postcode': postalPc,
                    'Email Address': eml,
                    'Home phone': homeArea,
                    'Home phone 1': homePrefix,
                    'Home phone 2': homeSuffix,
                    'Mobile': mobArea,     
                    'Mobile2': mobPrefix,
                    'Mobile3': mobSuffix,
                    'Declaration DD': curD,
                    'Declaration MM': curM,
                    'Declaration YY': curYY
                },

                // 10. Notice of Intent to Claim Tax Deduction
                'Cbus-how-to-claim-tax-deduction-super-contributions.pdf': {
                    'Cbus Member Number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Number / PO Box': resNum,
                    'Street Name': resName,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Postal Street Name or PO Box': postalAddr,
                    'Postal Suburb/town': postalSub,
                    'Postal State': postalSt,
                    'Postal Postcode': postalPc,
                    'Email address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'Mobile': mob,
                    'Declaration date DD': curD,
                    'Declaration date MM': curM,
                    'Declaration date YY': curYY
                },

                // 11. Life Event Insurance Change
                'App-Increase-Cover-Living-Events.pdf': {
                    'Media Super member number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Number': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Postal Street Number': postalAddr,
                    'Postal Suburb/town': postalSub,
                    'Postal State': postalSt,
                    'Postal Postcode': postalPc,
                    'Email address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile1': mob,
                    'decDD': curD,
                    'decMM': curM,
                    'decYYYY': curYY 
                },

                // 12. Withdraw Your Super
                'super-withdrawal-form.pdf': {
                    'Member number': mNo,
                    'First names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Number': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Postal Address if different': postalAddr,
                    'Suburb/town 2': postalSub,
                    'State 2': postalSt,
                    'Postcode 2': postalPc,
                    'Email address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'Telephone mobile': mob,
                    'TFN1': tfn.substring(0, 3),
                    'TFN2': tfn.substring(3, 6),
                    'TFN3': tfn.substring(6, 9),
                    '12 form 1 sign DD': curD,
                    '12 form 1 sign MM': curM,
                    '12 form 1 sign YY': curYY
                },

                // 13. Change My Insurance (Industry Super)
                'Change-Insurance-Form-Industry-Super.pdf': {
                    'Member Number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Number': addr,
                    'Street Number 2': postalAddr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Suburb/town 2': postalSub,
                    'State 2': postalSt,
                    'Postcode 2': postalPc,
                    'Email address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile1': mob,
                    'Declaration DD': curD,
                    'Declaration MM': curM,
                    'Declaration YY': curYY
                },

                // 14. Combine Your Super into Cbus
                'Combine-Form.pdf': {
                    'Given names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Number': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Email Address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile1': mob,
                    'TFN1': tfn.substring(0, 3),
                    'TFN2': tfn.substring(3, 6),
                    'TFN3': tfn.substring(6, 9),
                    'Combine Form Membership or acount number': mNo,
                    'Combine - Declaration DD': curD,
                    'Combine - Declaration MM': curM,
                    'Combine - Declaration YY': curYY
                },

                // 15. Join Cbus Industry Super
                'join-industry-form.pdf': {
                    'MEMBER number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Number and Name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Postal address street': postalAddr,
                    'Postal Suburb/town': postalSub,
                    'Postal State': postalSt,
                    'Postal Postcode': postalPc,
                    'Email address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile1': mob,
                    'TFN1': tfn.substring(0, 3),
                    'TFN2': tfn.substring(3, 6),
                    'TFN3': tfn.substring(6, 9),
                    'Join - Declaration DD': curD,
                    'Join - Declaration MM': curM,
                    'Join - Declaration YY': curYY
                },

                // 16. Pay My Super Into Cbus (Employer Choice)
                'I-want-my-super-paid-into-Cbus.pdf': {
                    '8039653-Given_Names': gn,
                    '8039653-Family_Name': fn,
                    '8039653-member_number': mNo,
                    '8039653-TFN1': tfn.substring(0, 3),
                    '8039653-TFN2': tfn.substring(3, 6),
                    '8039653-TFN3': tfn.substring(6, 9),
                    '8039778-Sign_Date_Day': curD,
                    '8039778-Sign_Date_Month': curM,
                    '8039778-Sign_Date_Year': curYY
                },

                // 17. Set Up Corporate Super Account
                'corporate-super-set-up.pdf': {
                    'MEMBER number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Number and Name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Postal address street': postalAddr,
                    'Postal Suburb/town': postalSub,
                    'Postal State': postalSt,
                    'Postal Postcode': postalPc,
                    'Email address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile1': mob,
                    'TFN1': tfn.substring(0, 3),
                    'TFN2': tfn.substring(3, 6),
                    'TFN3': tfn.substring(6, 9),
                    'Join - Declaration DD': curD,
                    'Join - Declaration MM': curM,
                    'Join - Declaration YY': curYY
                },

                // 18. Join Cbus Sole Trader Super
                'join-sole-trader.pdf': {
                    'Given names': gn,
                    'Family name': fn,
                    'Date of Birth DD': d,
                    'Date of Birth MM': m,
                    'Date of Birth YY': y,
                    'Street number and name': addr,
                    'Suburb': sub,
                    'State': st,
                    'Postcode': pc,
                    'Street number and name postal': postalAddr,
                    'Suburb postal': postalSub,
                    'State postal': postalSt,
                    'Postcode postal': postalPc,
                    'Email Address': eml,
                    'Telephone home': homeArea,
                    'Telephone home 1': homePrefix,
                    'Telephone home 2': homeSuffix,
                    'Mobile': mob,
                    'TFN1': tfn.substring(0, 3),
                    'TFN2': tfn.substring(3, 6),
                    'TFN3': tfn.substring(6, 9),
                    'Join - Declaration DD': curD,
                    'Join - Declaration MM': curM,
                    'Join - Declaration YY': curYY
                },

                // 19. Transfer Existing Insurance
                'Application-to-Transfer-Existing-Insurance-cover-transfer-form.pdf': {
                    'Cbus Super member number': mNo,
                    'Cbus member number': mNo,
                    'Member Number': mNo,
                    'MEMBER number': mNo,
                    'Member number': mNo,
                    'Given names': gn,
                    'Given name(s)': gn,
                    'Family name': fn,
                    'Last name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Date of Birth DD': d,
                    'Date of Birth MM': m,
                    'Date of Birth YY': y,
                    'Residential address': addr,
                    'Street Name': addr,
                    'Street name': addr,
                    'Street Number': addr,
                    'Street Number and Name': addr,
                    'Street number and name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Postal address': postalAddr,
                    'Postal address if different': postalAddr,
                    'Street Number 2': postalAddr,
                    'Postal address street': postalAddr,
                    'Street number and name postal': postalAddr,
                    'Posal - Street name': postalAddr,
                    'Suburb/town 2': postalSub,
                    'State 2': postalSt,
                    'Postcode 2': postalPc,
                    'Posal - Suburb': postalSub,
                    'Posal - State': postalSt,
                    'Postcode - Posal': postalPc,
                    'Email address': eml,
                    'Email Address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile1': mob,
                    'mobile': mob,
                    'Mobile': mob,
                    'decDD': curD,
                    'Declaration DD': curD,
                    'Join - Declaration DD': curD,
                    'Step 4 date': curD,
                    'Step 4 date DD': curD,
                    'Declaration date DD': curD,
                    '12 form 1 sign DD': curD,
                    'decMM': curM,
                    'Declaration MM': curM,
                    'Join - Declaration MM': curM,
                    'Step 4 date MM': curM,
                    'Declaration date MM': curM,
                    '12 form 1 sign MM': curM,
                    'decYY': curYY,
                    'decYYYY': curYY,
                    'Declaration YY': curYY,
                    'Join - Declaration YY': curYY,
                    'Step 4 date YY': curYY,
                    'Step 4 date YYYY': curYY,
                    'Declaration date YY': curYY,
                    '12 form 1 sign YY': curYY
                },

                // 20. Third Party Authority
                'Third-Party-Authority-Form.pdf': {
                    'Cbus member number': mNo,
                    'Cbus income stream number': mNo,
                    'First names': gn,
                    'Last name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Number Name RES': addr,
                    'Suburb/town RES': sub,
                    'State RES': st,
                    'Postcode RES': pc,
                    'Street Number Name POST': postalAddr,
                    'Suburb/town POST': postalSub,
                    'State POST': postalSt,
                    'Postcode POST': postalPc,
                    'Email address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'Telephone mobile': mob,
                    'Signatory date day': curD,
                    'Signatory date month': curM,
                    'Signatory date year': curYY
                },

                // 21. Join Cbus Super Income Stream
                'cbus-super-income-stream-join-form.pdf': {
                    'Cbus super member number': mNo,
                    'Cbus member number': mNo,
                    'Member number': mNo,
                    'Cbus Super or Media Super member number, if known': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Residential address': addr,
                    'Street Name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'postal Street Name': postalAddr,
                    'postal Suburb/town': postalSub,
                    'postal State': postalSt,
                    'postal Postcode': postalPc,
                    'Email address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile': mob,
                    '12 form 1 sign DD': curD,
                    '12 form 1 sign MM': curM,
                    '12 form 1 sign YY': curYY
                },

                // 22. Change Your Income Stream Details
                'Change-Income-Stream-Details-Form.pdf': {
                    'Cbus member number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Number Name RES': addr,
                    'Suburb/town RES': sub,
                    'State RES': st,
                    'Postcode RES': pc,
                    'Street Number Name POST': postalAddr,
                    'Suburb/town POST': postalSub,
                    'State POST': postalSt,
                    'Postcode POST': postalPc,
                    'Email address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile1': mob,
                    'Step 6 - DD': curD,
                    'Step 6 - MM': curM,
                    'Step 6 - YYYY': curYY 
                },

                // 23. SIS Binding Death Benefit Nomination
                'SIS-Binding-Death-Nomination-Form.pdf': {
                    'Cbus member number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile': mob,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'postal Street Name': postalAddr,
                    'postal Suburb/town': postalSub,
                    'postal State': postalSt,
                    'postal Postcode': postalPc,
                    'Email address': eml,

                    'Sign day binding': curD,
                    'Sign month binding': curM,
                    'Sign year binding': curYY,

                    'Witness 1 date day': curD,
                    'Witness 1 date month': curM,
                    'Witness 1 date year': curYY,

                    'Witness 2 date day': curD,
                    'Witness 2 date year': curYY
                },

                // 24. Transition to Retirement PDS
                'ttr-sis-pds.pdf': {
                    '8050898-Given_Names': gn,
                    '8050898-Family_Name': fn,
                    '8050898-DOB_Day': d,
                    '8050898-DOB_Month': m,
                    '8050898-DOB_Year': y,
                    '8050898-Residential_Address': addr,
                    '8050898-Residential_Suburb': sub,
                    '8050898-Residential_State': st,
                    '8050898-Residential_Postcode': pc,
                    'postal Street Name': postalAddr,
                    'postal Suburb/town': postalSub,
                    'postal State': postalSt,
                    'postal Postcode': postalPc,
                    'Email address': eml,
                    '8050898-Home_Phone1': homeArea,
                    '8050898-Home_Phone2': homePrefix,
                    '8050898-Home_Phone3': homeSuffix,
                    '8050898-Mobile': mob,
                    '8050898-TFN1': tfn.substring(0, 3),
                    '8050898-TFN2': tfn.substring(3, 6),
                    '8050898-TFN3': tfn.substring(6, 9),
                    
                    '8050902-Sign_Date_Day': curD,
                    '8050902-Sign_Date_Month': curM,
                    '8050902-Sign_Date_Year': curYY,
                    
                    '12 form 1 sign DD': curD,
                    '12 form 1 sign MM': curM,
                    '12 form 1 sign YY': curYY,
                    'Cbus member number step 5': mNo,
                    
                    'Cbus super member number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile': mob,
                    
                    'Sign day binding': curD,
                    'Sign month binding': curM,
                    'Sign year binding': curYY,
                    'Witness 1 date day': curD,
                    'Witness 1 date month': curM,
                    'Witness 1 date year': curYY,
                    'Witness 2 date day': curD,
                    'Witness 2 date year': curYY
                },

                // 25. Fully Retired PDS
                'fr-sis-pds.pdf': {
                    '8050898-Given_Names': gn,
                    '8050898-Family_Name': fn,
                    '8050898-DOB_Day': d,
                    '8050898-DOB_Month': m,
                    '8050898-DOB_Year': y,
                    '8050898-Residential_Address': addr,
                    '8050898-Residential_Suburb': sub,
                    '8050898-Residential_State': st,
                    '8050898-Residential_Postcode': pc,
                    'postal Street Name': postalAddr,
                    'postal Suburb/town': postalSub,
                    'postal State': postalSt,
                    'postal Postcode': postalPc,
                    'Email address': eml,
                    '8050898-Home_Phone1': homeArea,
                    '8050898-Home_Phone2': homePrefix,
                    '8050898-Home_Phone3': homeSuffix,
                    '8050898-Mobile': mob,
                    '8050898-TFN1': tfn.substring(0, 3),
                    '8050898-TFN2': tfn.substring(3, 6),
                    '8050898-TFN3': tfn.substring(6, 9),
                    
                    '8050902-Sign_Date_Day': curD,
                    '8050902-Sign_Date_Month': curM,
                    '8050902-Sign_Date_Year': curYY,
                    
                    '12 form 1 sign DD': curD,
                    '12 form 1 sign MM': curM,
                    '12 form 1 sign YY': curYY,
                    'Cbus member number step 5': mNo,
                    
                    'Cbus super member number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'mobile': mob,
                    
                    'Sign day binding': curD,
                    'Sign month binding': curM,
                    'Sign year binding': curYY,
                    'Witness 1 date day': curD,
                    'Witness 1 date month': curM,
                    'Witness 1 date year': curYY,
                    'Witness 2 date day': curD,
                    'Witness 2 date year': curYY
                },

                // 26. Investment Choice Form (Income Stream)
                'SIS-Switching-Form.pdf': {
                    'Cbus member number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Number Name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Postal address': postalAddr,
                    'Suburb/town postal': postalSub,
                    'State postal': postalSt,
                    'Postcode postal': postalPc,
                    'email address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'Mobile number 1': mob,
                    'S8 DD': curD,
                    'S8 MM': curM,
                    'S8 yyyy': curYY 
                },

                // 27. Income Stream Withdrawal or Rollover
                'SIS-Withdrawal-Form.pdf': {
                    'Cbus member number': mNo,
                    'Given names': gn,
                    'Family name': fn,
                    'Date of birth day': d,
                    'Date of birth month': m,
                    'Date of birth year': y,
                    'Street Number Name': addr,
                    'Suburb/town': sub,
                    'State': st,
                    'Postcode': pc,
                    'Postal address': postalAddr,
                    'Suburb/town postal': postalSub,
                    'State postal': postalSt,
                    'Postcode postal': postalPc,
                    'email address': eml,
                    'Telephone home': homeArea,
                    'Telephone home1': homePrefix,
                    'Telephone home2': homeSuffix,
                    'Mobile number 1': mob,
                    'S8 DD': curD,
                    'S8 MM': curM,
                    'S8 yyyy': curYY 
                }
            };

            for (const item of selected) {
                const formFileName = item.value;
                status.innerText = `📡 Downloading clean template: ${formFileName}...`;

                const pdfResponse = await fetch(`${BASE_DATA_URL}${formFileName}`);
                if (!pdfResponse.ok) {
                    throw new Error("Could not download template.");
                }
                
                const arrayBuffer = await pdfResponse.arrayBuffer();
                
                const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
                const form = pdfDoc.getForm();
                
                try { if (form.hasXFA()) form.deleteXFA(); } catch(e) {}
                // Keep Acrobat from regenerating the unusual shared Title/Gender checkbox
                // appearances. Chrome will happily render the /AS state, while Acrobat can
                // erase it when NeedAppearances is true.
                try { if (form.acroForm) form.acroForm.dict.set(PDFLib.PDFName.of('NeedAppearances'), PDFLib.PDFBool.False); } catch(e) {}

                const fields = form.getFields();

                const activeMap = formSpecificMaps[formFileName] || {};
                const activeMapClean = {};
                for (const key in activeMap) {
                    activeMapClean[getCleanKey(key)] = activeMap[key];
                }

                fields.forEach((field) => {
                    const fieldName = field.getName();
                    const cleanFieldName = getCleanKey(fieldName);
                    
                    const isTextField = field instanceof PDFLib.PDFTextField;
                    const isCheckBox = field instanceof PDFLib.PDFCheckBox;
                    const isDropdown = field instanceof PDFLib.PDFDropdown;
                    const isRadioGroup = field instanceof PDFLib.PDFRadioGroup;

                    try {
                        const targetValue = activeMapClean[cleanFieldName];

                        if (targetValue !== undefined && targetValue !== null && targetValue !== "") {
                            if (isTextField) {
                                try { if (field.isRichFormatted()) field.disableRichFormatting(); } catch(e) {}
                                try { field.setFontSize(10); } catch(e) {}
                                field.setText(String(targetValue));
                            } else if (isCheckBox) {
                                if (targetValue === true || targetValue === "checked" || targetValue === "On" || targetValue === "Yes") {
                                    field.check();
                                } else if (targetValue === false || targetValue === "unchecked" || targetValue === "Off" || targetValue === "No") {
                                    field.uncheck();
                                }
                            } else if (isDropdown || isRadioGroup) {
                                field.select(String(targetValue));
                            }
                        }
                    } catch (e) {
                        console.warn(`Could not fill field: "${fieldName}"`, e);
                    }
                });

                try { form.updateFieldAppearances(); } catch(e) {}

                // IMPORTANT: Cbus Title/Gender are multi-widget checkbox groups sharing
                // one field name. pdf-lib's global appearance refresh resets these groups
                // to the first widget (Mr/Male). Apply the chosen widget state AFTER the
                // appearance refresh so Miss/Mrs/Ms/Other and Female remain selected.
                for (const field of fields) {
                    const genericName = getCleanKey(field.getName());
                    if (genericName === getCleanKey('Title') && title) selectWidgetChoice(field, title);
                    if (genericName === getCleanKey('Gender') && gender) selectWidgetChoice(field, gender);
                }

                // Final compatibility safeguard for Adobe Acrobat: use the appearance
                // streams/states we have explicitly set instead of asking the viewer to
                // synthesize new ones.
                try { if (form.acroForm) form.acroForm.dict.set(PDFLib.PDFName.of('NeedAppearances'), PDFLib.PDFBool.False); } catch(e) {}

                const pdfBytes = await pdfDoc.save();
                const blob = new Blob([pdfBytes], { type: "application/pdf" });
                const localUrl = URL.createObjectURL(blob);

                // Get the friendly document title
const documentTitle =
    documentTitles[formFileName] ||
    formFileName.replace(/\.pdf$/i, '');

// Build a clean filename for later automation
// Example:
// 12345678 - John Smith - Join Cbus Super Income Stream.pdf

const filenameParts = [];

// Member number first
if (mNo) {
    filenameParts.push(mNo);
}

// Member name
if (fullNamePrefix && fullNamePrefix !== 'Member_Form') {
    filenameParts.push(fullNamePrefix);
} else {
    filenameParts.push('Member');
}

// Friendly document title
filenameParts.push(documentTitle);

// Remove characters that Windows does not allow in filenames
const safeFileName =
    filenameParts
        .join(' - ')
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, ' ')
        .trim() + '.pdf';

const a = document.createElement('a');
a.href = localUrl;
a.download = safeFileName;

document.body.appendChild(a);
a.click();
document.body.removeChild(a);

URL.revokeObjectURL(localUrl);
            }

            status.style.color = "var(--cbus)";
            status.innerText = "✅ Batch process complete! Checked files saved to Downloads folder.";

        } catch (err) {
            status.style.color = "red";
            status.innerText = `❌ Error: ${err.message}`;
            alert(`Engine Interrupted: ${err.message}`);
        }
    }

// Event bindings are external rather than inline, allowing CSP to reject inline script execution.
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('mode-manual')?.addEventListener('click', () => switchInputMode('manual'));
    document.getElementById('mode-import')?.addEventListener('click', () => switchInputMode('import'));
    document.getElementById('parse-data')?.addEventListener('click', parsePastedText);
    document.getElementById('clear-fields')?.addEventListener('click', clearAllFields);
    document.getElementById('clear-fields-bottom')?.addEventListener('click', clearAllFields);
    document.getElementById('generate-forms')?.addEventListener('click', runBatchProcessing);
});
