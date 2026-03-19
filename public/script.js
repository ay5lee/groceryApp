const token = localStorage.getItem('token');
const role = localStorage.getItem('role');
const username = localStorage.getItem('username');
const BASE_PATH = (window.APP_BASE_PATH || '').replace(/\/+$/, '');

function withBasePath(path) {
  if (!BASE_PATH) return path;
  if (!path || path === '/') return BASE_PATH;
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizePath(path) {
  return (path || '/').replace(/\/+$/, '') || '/';
}

function normalizeTransactionType(type) {
  return type === 'cash' ? 'given' : type;
}

function displayTransactionType(type) {
  return type === 'given' ? 'cash' : type;
}

function isCreditTransactionType(type, category) {
  return type === 'given' || type === 'cash' || category === 'credit';
}

function resolveReceiptUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return withBasePath(url.startsWith('/') ? url : `/${url}`);
}

function buildReceiptLinkHtml(transaction) {
  if (!transaction.receipt_url) return '';
  const receiptUrl = resolveReceiptUrl(transaction.receipt_url);
  return `<a class="receipt-link" href="${receiptUrl}" target="_blank" rel="noopener noreferrer"><i class="fas fa-receipt"></i> View receipt</a>`;
}

// Compress an image File to JPEG before upload (max 1600px, quality 0.80)
function compressImage(file, maxDim = 1600, quality = 0.80) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => resolve(file); // fallback: use original
    };
    reader.onerror = () => resolve(file);
  });
}

function showUploadOverlay() {
  const el = document.getElementById('upload-overlay');
  if (el) el.classList.add('active');
}

function hideUploadOverlay() {
  const el = document.getElementById('upload-overlay');
  if (el) el.classList.remove('active');
}

const currentPath = normalizePath(window.location.pathname);

// Simple HTML escape to avoid injecting raw notes into DOM
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&"'<>]/g, function (s) {
    return ({'&':'&amp;','"':'&quot;',"'":'&#39;','<':'&lt;','>':'&gt;'})[s];
  });
}

// Pagination state
let currentPage = 1;
const itemsPerPage = 10;
let allTransactions = [];

if (currentPath === normalizePath(withBasePath('/dashboard')) && !token) {
  window.location.href = withBasePath('/');
}

document.addEventListener('DOMContentLoaded', () => {
  if (currentPath === normalizePath(withBasePath('/'))) {
    const loginForm = document.getElementById('loginForm');
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const response = await fetch(withBasePath('/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('role', data.role);
        localStorage.setItem('username', data.username);
        window.location.href = withBasePath('/dashboard');
      } else {
        document.getElementById('error').textContent = data.error;
      }
    });
  } else if (currentPath === normalizePath(withBasePath('/dashboard'))) {
    // Set default datetime to current HKT time
    function getHKTDatetime() {
      const now = new Date();
      // Get HKT time (UTC+8)
      const hktTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
      
      // Pad function for formatting
      const pad = (n) => String(n).padStart(2, '0');
      
      const year = hktTime.getFullYear();
      const month = pad(hktTime.getMonth() + 1);
      const day = pad(hktTime.getDate());
      const hours = pad(hktTime.getHours());
      const minutes = pad(hktTime.getMinutes());
      
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    
    const datetimeInput = document.getElementById('datetime');
    datetimeInput.value = getHKTDatetime();
    
    document.getElementById('username').textContent = username;
    document.getElementById('role').textContent = role;
    
    // Load transaction types and populate form
    loadTransactionTypesForForm();
    
    if (role === 'admin') {
      document.getElementById('reportsLink').style.display = 'inline';
      document.getElementById('usersLink').style.display = 'inline';
      document.getElementById('configLink').style.display = 'inline';
    }
    
    loadTransactions();
    // Ensure dashboard/cards align to navbar on load and resize
    setTimeout(() => syncLayoutWithNav(), 80);
    window.addEventListener('resize', () => debounceSyncLayout());
    
    // Navigation
    document.getElementById('dashboardLink').addEventListener('click', (e) => {
      e.preventDefault();
      showView('dashboard');
    });
    document.getElementById('reportsLink').addEventListener('click', (e) => {
      e.preventDefault();
      showView('reports');
      loadReports();
    });
    document.getElementById('usersLink').addEventListener('click', (e) => {
      e.preventDefault();
      showView('users');
      loadUsers();
    });
    
    document.getElementById('configLink').addEventListener('click', (e) => {
      e.preventDefault();
      showView('config');
      loadTransactionTypes();
    });
    
    // User form handler
    const userForm = document.getElementById('userForm');
    if (userForm) {
      userForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('newUsername').value;
        const password = document.getElementById('newPassword').value;
        const role = document.getElementById('newRole').value;
        
        const response = await fetch(withBasePath('/api/users'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ username, password, role })
        });
        
        if (response.ok) {
          loadUsers();
          userForm.reset();
        } else {
          const error = await response.json();
          alert('Error: ' + error.error);
        }
      });
    }
    
    const transactionForm = document.getElementById('transactionForm');
    transactionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const datetimeStr = document.getElementById('datetime').value;
      const amount = document.getElementById('amount').value;
      const type = normalizeTransactionType(document.getElementById('type').value);
      const notes = document.getElementById('notes').value;
      const receiptInput = document.getElementById('receipt');
      const rawReceiptFile = receiptInput && receiptInput.files && receiptInput.files[0] ? receiptInput.files[0] : null;
      
      // Properly convert datetime-local (HKT) to UTC
      // datetime-local format: "2026-03-10T14:30"
      const [date, time] = datetimeStr.split('T');
      const [year, month, day] = date.split('-').map(Number);
      const [hours, minutes] = time.split(':').map(Number);
      
      // Subtract 8 hours to convert HKT to UTC
      let utcHours = hours - 8;
      let utcDay = day;
      
      if (utcHours < 0) {
        utcHours += 24;
        utcDay -= 1;
      }
      
      // Create proper UTC date
      const utcDate = new Date(Date.UTC(year, month - 1, utcDay, utcHours, minutes, 0));
      const utcISOString = utcDate.toISOString();

      // Compress image if provided, then block UI during upload
      let receiptFile = rawReceiptFile;
      if (rawReceiptFile) {
        receiptFile = await compressImage(rawReceiptFile);
      }

      showUploadOverlay();
      try {
        const formData = new FormData();
        formData.append('datetime', utcISOString);
        formData.append('amount', amount);
        formData.append('type', type);
        formData.append('notes', notes || '');
        if (receiptFile) {
          formData.append('receipt', receiptFile);
        }

        const response = await fetch(withBasePath('/api/transactions'), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });
        if (response.ok) {
          loadTransactions();
          transactionForm.reset();
          // Reset datetime to current HKT
          document.getElementById('datetime').value = getHKTDatetime();
        } else {
          const error = await response.json();
          alert('Error: ' + (error.error || 'Failed to add transaction'));
        }
      } finally {
        hideUploadOverlay();
      }
    });
    
    // Type form handler for configuration
    const typeForm = document.getElementById('typeForm');
    if (typeForm) {
      typeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const typeName = document.getElementById('typeName').value;
        const typeCategory = document.getElementById('typeCategory').value;
        
        const response = await fetch(withBasePath('/api/transaction-types'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ name: typeName, category: typeCategory })
        });
        
        if (response.ok) {
          loadTransactionTypes();
          loadTransactionTypesForForm();
          typeForm.reset();
        } else {
          const error = await response.json();
          alert('Error: ' + error.error);
        }
      });
    }
    document.getElementById('logout').addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      localStorage.removeItem('username');
      window.location.href = withBasePath('/');
    });
  }
});

async function loadTransactionTypesForForm() {
  try {
    const response = await fetch(withBasePath('/api/transaction-types'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const types = await response.json();
    const typeSelect = document.getElementById('type');
    
    let html = '';
    let defaultValue = '';
    
    if (role === 'admin') {
      // Admin can see all transaction types
      types.forEach(t => {
        const labelName = displayTransactionType(t.name);
        html += `<option value="${normalizeTransactionType(t.name)}">${labelName.charAt(0).toUpperCase() + labelName.slice(1)} (${t.category})</option>`;
      });
      // Default to cash/given if it exists, otherwise first type
      defaultValue = normalizeTransactionType(types.find(t => t.name === 'given' || t.name === 'cash')?.name || types[0]?.name);
    } else if (role === 'helper') {
      // Helper can only see expense types (not credit)
      const expenseTypes = types.filter(t => t.category === 'expense');
      expenseTypes.forEach(t => {
        const labelName = displayTransactionType(t.name);
        html += `<option value="${normalizeTransactionType(t.name)}">${labelName.charAt(0).toUpperCase() + labelName.slice(1)}</option>`;
      });
      // Default to first expense type
      defaultValue = normalizeTransactionType(expenseTypes[0]?.name);
    }
    
    typeSelect.innerHTML = html;
    if (defaultValue) typeSelect.value = defaultValue;
  } catch (err) {
    console.error('Error loading transaction types:', err);
  }
}

// Measure `.nav-container` and apply matching width/left margin to `.dashboard-container`
function syncLayoutWithNav() {
  try {
    const nav = document.querySelector('.nav-container');
    const dash = document.querySelector('.dashboard-container');
    if (!nav || !dash) return;
    const navRect = nav.getBoundingClientRect();
    const computed = window.getComputedStyle(nav);

    // Set dashboard to match nav's visual width (max-width) and center it
    dash.style.maxWidth = navRect.width + 'px';
    dash.style.width = '100%';
    dash.style.margin = '12px auto';

    // Mirror side padding from nav to keep visual alignment
    dash.style.paddingLeft = computed.paddingLeft;
    dash.style.paddingRight = computed.paddingRight;

    // Ensure cards don't exceed container
    document.querySelectorAll('.dashboard-container .card').forEach(c => {
      c.style.maxWidth = '100%';
      c.style.boxSizing = 'border-box';
      c.style.marginLeft = '0';
      c.style.marginRight = '0';
    });
  } catch (err) {
    console.warn('syncLayoutWithNav error', err);
  }
}

// Debounce helper for resize
let __syncLayoutTimer = null;
function debounceSyncLayout() {
  if (__syncLayoutTimer) clearTimeout(__syncLayoutTimer);
  __syncLayoutTimer = setTimeout(() => syncLayoutWithNav(), 120);
}

function showView(view) {
  document.getElementById('dashboardView').style.display = view === 'dashboard' ? 'grid' : 'none';
  document.getElementById('reportsView').style.display = view === 'reports' ? 'grid' : 'none';
  document.getElementById('usersView').style.display = view === 'users' ? 'grid' : 'none';
  document.getElementById('configView').style.display = view === 'config' ? 'grid' : 'none';
  document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
  document.getElementById(view + 'Link').classList.add('active');
}

async function loadTransactions() {
  const response = await fetch(withBasePath('/api/transactions'), {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  allTransactions = await response.json();
  currentPage = 1;
  displayTransactionsPage();
  updateCurrentBalance();
}

function updateCurrentBalance() {
  const el = document.getElementById('currentBalanceValue');
  const meta = document.getElementById('currentBalanceMeta');
  if (!el) return;
  if (!allTransactions || allTransactions.length === 0) {
    el.textContent = '$0.00';
    if (meta) meta.textContent = 'No transactions yet';
    return;
  }

  // Use the most recent transaction (by datetime) to show current balance
  const latest = allTransactions.slice().sort((a,b) => new Date(b.datetime) - new Date(a.datetime))[0];
  const balance = (Number(latest.balance) || 0).toFixed(2);
  el.textContent = `$${balance}`;
  if (meta) {
    try {
      const dt = new Date(latest.datetime);
      const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Hong_Kong' });
      meta.textContent = `Updated ${fmt.format(dt)}`;
    } catch (err) {
      meta.textContent = '';
    }
  }
}

function displayTransactionsPage() {
  const tbody = document.querySelector('#transactionsTable tbody');
  const cardsContainer = document.getElementById('transactionsCards');
  tbody.innerHTML = '';
  if (cardsContainer) cardsContainer.innerHTML = '';
  const isMobile = window.matchMedia('(max-width: 414px)').matches;
  
  // Calculate pagination
  const totalPages = Math.ceil(allTransactions.length / itemsPerPage);
  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const pageTransactions = allTransactions.slice(startIdx, endIdx);
  
  // Display transactions for current page
  pageTransactions.forEach(t => {
    const isCredit = isCreditTransactionType(t.type, t.category);
    const sign = isCredit ? '+' : '-';
    const typeLabel = displayTransactionType(t.type);

    // Convert UTC datetime to HKT display
    const dateObj = new Date(t.datetime);
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Hong_Kong'
    });
    const parts = formatter.formatToParts(dateObj);
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    const hour = parts.find(p => p.type === 'hour').value;
    const minute = parts.find(p => p.type === 'minute').value;
    const dateStr = `${month}/${day}`;
    const timeStr = `${hour}:${minute}`;

    if (isMobile && cardsContainer) {
      // Render stacked card
      const card = document.createElement('div');
      card.className = 'transaction-card ' + (isCredit ? 'card-credit' : 'card-expense');
      const amountDisplay = (Number(t.amount) || 0).toFixed(2);
      const balanceDisplay = (Number(t.balance) || 0).toFixed(2);

      card.innerHTML = `
        <div class="card-top">
          <div class="card-left">
            <div class="card-date">${dateStr} ${timeStr}</div>
            <div class="card-type">${typeLabel}</div>
          </div>
        </div>
        <div class="card-center">
          <div class="card-amount"><strong>${sign}$${amountDisplay}</strong></div>
          <div class="card-balance">$${balanceDisplay}</div>
        </div>
        <div class="card-notes" style="display:none">
          ${t.notes ? escapeHtml(t.notes) : '<em>No notes</em>'}
          ${buildReceiptLinkHtml(t)}
          ${role === 'admin' ? `<button class="btn btn-small action-btn notes-delete-btn" data-id="${t.id}" title="Delete"><i class="fas fa-trash"></i> Delete</button>` : ''}
        </div>
        <div class="card-actions"><button class="btn btn-small toggle-notes">Notes</button></div>
      `;

      // Toggle notes
      const toggleBtn = card.querySelector('.toggle-notes');
      const notesEl = card.querySelector('.card-notes');
      toggleBtn.addEventListener('click', () => {
        const isVisible = notesEl.style.display === 'block';
        notesEl.style.display = isVisible ? 'none' : 'block';
      });

      // Attach delete action if present
      const delBtn = card.querySelector('.action-btn');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = e.currentTarget.getAttribute('data-id');
          deleteTransaction(id);
        });
      }

      cardsContainer.appendChild(card);
    } else {
      // Desktop / table rendering (existing behavior)
      const row = document.createElement('tr');
      const rowClass = isCredit ? 'row-credit transaction-row' : 'row-expense transaction-row';
      row.className = rowClass;

      const amountDisplay = (Number(t.amount) || 0).toFixed(2);
      const balanceDisplay = (Number(t.balance) || 0).toFixed(2);
      row.innerHTML = `
        <td>${dateStr} ${timeStr}</td>
        <td><strong>${sign}$${amountDisplay}</strong></td>
        <td>${typeLabel}</td>
        <td>$${balanceDisplay}</td>
      `;

      const notesRow = document.createElement('tr');
      notesRow.className = 'notes-row';
      const notesCell = document.createElement('td');
      notesCell.colSpan = 4;
      notesCell.innerHTML = `
        <div class="notes-content">${t.notes ? escapeHtml(t.notes) : '<em>No notes</em>'}</div>
        ${buildReceiptLinkHtml(t)}
        ${role === 'admin' ? `<button onclick="deleteTransaction(${t.id})" class="btn btn-small action-btn notes-delete-btn" title="Delete"><i class="fas fa-trash"></i> Delete</button>` : ''}
      `;
      notesRow.appendChild(notesCell);

      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const isVisible = notesRow.style.display === 'table-row';
        notesRow.style.display = isVisible ? 'none' : 'table-row';
        row.classList.toggle('selected', !isVisible);
      });

      tbody.appendChild(row);
      tbody.appendChild(notesRow);
    }
  });
  
  // Update pagination controls
  updatePaginationControls(totalPages);

  // Toggle visibility of table vs cards container
  const tableEl = document.getElementById('transactionsTable');
  if (isMobile && cardsContainer) {
    tableEl.style.display = 'none';
    cardsContainer.style.display = 'block';
  } else {
    tableEl.style.display = '';
    if (cardsContainer) cardsContainer.style.display = 'none';
  }
}

function updatePaginationControls(totalPages) {
  const paginationDiv = document.getElementById('transactionsPagination');
  paginationDiv.innerHTML = '';
  
  if (totalPages <= 1) return;
  
  // Previous button
  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-pagination';
  prevBtn.textContent = '← Previous';
  prevBtn.disabled = currentPage === 1;
  prevBtn.onclick = () => {
    if (currentPage > 1) {
      currentPage--;
      displayTransactionsPage();
    }
  };
  paginationDiv.appendChild(prevBtn);
  
  // Page info
  const pageInfo = document.createElement('span');
  pageInfo.className = 'pagination-info';
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  paginationDiv.appendChild(pageInfo);
  
  // Next button
  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-pagination';
  nextBtn.textContent = 'Next →';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.onclick = () => {
    if (currentPage < totalPages) {
      currentPage++;
      displayTransactionsPage();
    }
  };
  paginationDiv.appendChild(nextBtn);
}

async function loadReports() {
  const response = await fetch(withBasePath('/api/reports'), {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();
  const reportsContent = document.getElementById('reportsContent');
  reportsContent.innerHTML = `
    <div class="report-summary">
      <div class="summary-item">
        <h4>Total Cash</h4>
        <p>$${data.totalGiven}</p>
      </div>
      <div class="summary-item">
        <h4>Total Spent</h4>
        <p>$${data.totalSpent}</p>
      </div>
      <div class="summary-item">
        <h4>Remaining Balance</h4>
        <p>$${data.totalGiven - data.totalSpent}</p>
      </div>
    </div>
    <h4>Spending by Category</h4>
    <ul class="category-list">
      ${data.byCategory.map(cat => `<li>${cat.type}: $${cat.total}</li>`).join('')}
    </ul>
  `;
}

async function loadUsers() {
  const response = await fetch(withBasePath('/api/users'), {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const users = await response.json();
  const usersContent = document.getElementById('usersContent');
  usersContent.innerHTML = `
    <table id="usersTable">
      <thead>
        <tr>
          <th>Username</th>
          <th>Role</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${users.map(user => `
          <tr>
            <td>${user.username}</td>
            <td>${user.role}</td>
            <td>
              <button onclick="editUser(${user.id}, '${user.username}', '${user.role}')" class="btn btn-small">Edit</button>
              <button onclick="deleteUser(${user.id}, '${user.username}')" class="btn btn-small">Delete</button>
              <button onclick="resetPassword(${user.id}, '${user.username}')" class="btn btn-small">Reset Password</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function editUser(userId, username, role) {
  const newUsername = prompt('Enter new username:', username);
  if (!newUsername || newUsername.trim() === '') return;
  
  const newRole = confirm(`Change role from "${role}" to "Admin"?\nClick Cancel to keep as "Helper"`) ? 'admin' : 'helper';
  
  fetch(withBasePath(`/api/users/${userId}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ username: newUsername, role: newRole })
  }).then(response => {
    if (response.ok) {
      alert('User updated successfully');
      loadUsers();
    } else {
      response.json().then(error => {
        alert('Error: ' + error.error);
      });
    }
  });
}

function resetPassword(userId, username) {
  const newPassword = prompt(`Enter new password for ${username}:`);
  if (!newPassword) return;
  
  fetch(withBasePath(`/api/users/${userId}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ password: newPassword })
  }).then(response => {
    if (response.ok) {
      alert('Password updated successfully');
    } else {
      alert('Failed to update password');
    }
  });
}

function deleteUser(userId, username) {
  if (confirm(`Are you sure you want to delete user "${username}"?`)) {
    fetch(withBasePath(`/api/users/${userId}`), {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(response => {
      if (response.ok) {
        alert('User deleted successfully');
        loadUsers();
      } else {
        response.json().then(error => {
          alert('Error: ' + error.error);
        });
      }
    });
  }
}

async function deleteTransaction(id) {
  if (confirm('Are you sure you want to delete this transaction?')) {
    await fetch(withBasePath(`/api/transactions/${id}`), {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    loadTransactions();
  }
}

async function loadTransactionTypes() {
  const response = await fetch(withBasePath('/api/transaction-types'), {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const types = await response.json();
  const configContent = document.getElementById('configContent');
  
  if (types.length === 0) {
    configContent.innerHTML = '<p>No transaction types configured.</p>';
    return;
  }
  
  let html = '<table id="typesTable"><thead><tr><th>Name</th><th>Category</th><th>Actions</th></tr></thead><tbody>';
  types.forEach(t => {
    const typeNameLabel = displayTransactionType(t.name);
    html += `
      <tr>
        <td>${typeNameLabel}</td>
        <td>
          <span style="background: ${t.category === 'credit' ? '#4CAF50' : '#FF9800'}; color: white; padding: 4px 8px; border-radius: 4px;">
            ${t.category}
          </span>
        </td>
        <td>
          <button onclick="editTransactionType(${t.id}, '${t.name}', '${t.category}')" class="btn btn-small">Edit</button>
          <button onclick="deleteTransactionType(${t.id})" class="btn btn-small">Delete</button>
        </td>
      </tr>
    `;
  });
  html += '</tbody></table>';
  configContent.innerHTML = html;
}

async function editTransactionType(id, name, category) {
  const newName = prompt('Enter new name:', name);
  if (!newName) return;
  
  const newCategory = confirm('Is this a credit type? (OK=credit, Cancel=expense)') ? 'credit' : 'expense';
  
  const response = await fetch(withBasePath(`/api/transaction-types/${id}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ name: newName, category: newCategory })
  });
  
  if (response.ok) {
    loadTransactionTypes();
    loadTransactionTypesForForm();
  } else {
    const error = await response.json();
    alert('Error: ' + error.error);
  }
}

async function deleteTransactionType(id) {
  if (confirm('Are you sure you want to delete this transaction type?')) {
    const response = await fetch(withBasePath(`/api/transaction-types/${id}`), {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      loadTransactionTypes();
      loadTransactionTypesForForm();
    } else {
      alert('Error deleting transaction type');
    }
  }
}