const { ipcRenderer } = require('electron');

let projects = [];
let currentProjectIndex = null;
let editingProjectIndex = null;

// DOM Elements
const projectsList = document.getElementById('projects-list');
const emptyState = document.getElementById('empty-state');
const projectDetail = document.getElementById('project-detail');
const projectForm = document.getElementById('project-form');
const toolsGrid = document.getElementById('tools-grid');

// Buttons
const addProjectBtn = document.getElementById('add-project-btn');
const editProjectBtn = document.getElementById('edit-project-btn');
const launchAllBtn = document.getElementById('launch-all-btn');
const minimizeBtn = document.getElementById('minimize-btn');
const closeBtn = document.getElementById('close-btn');
const saveProjectBtn = document.getElementById('save-project-btn');
const cancelBtn = document.getElementById('cancel-btn');
const cancelFormBtn = document.getElementById('cancel-form-btn');
const deleteProjectBtn = document.getElementById('delete-project-btn');
const addToolBtn = document.getElementById('add-tool-btn');

// Tool type icons and labels
const toolTypes = {
  vscode: { icon: '📝', label: 'VS Code', fields: ['path'] },
  terminal: { icon: '💻', label: 'Terminal', fields: ['path'] },
  powershell: { icon: '⚡', label: 'PowerShell', fields: ['path'] },
  'powershell-command': { icon: '⚡', label: 'PowerShell Command', fields: ['command', 'path'] },
  browser: { icon: '🌐', label: 'Browser', fields: ['url'] },
  'docker-compose': { icon: '🐳', label: 'Docker Compose', fields: ['path'] },
  command: { icon: '⚙️', label: 'Custom Command', fields: ['command'] },
  file: { icon: '📁', label: 'Open File', fields: ['path'] }
};

// Initialize
async function init() {
  projects = await ipcRenderer.invoke('get-projects');
  renderProjects();

  if (projects.length > 0) {
    showProject(0);
  }
}

// Render projects list
function renderProjects() {
  projectsList.innerHTML = '';

  if (projects.length === 0) {
    projectsList.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No projects yet</div>';
    return;
  }

  projects.forEach((project, index) => {
    const projectItem = document.createElement('div');
    projectItem.className = `project-item ${index === currentProjectIndex ? 'active' : ''}`;
    projectItem.innerHTML = `
      <h3>${project.name}</h3>
      <p>${project.description || 'No description'}</p>
      <div class="tool-count">${project.tools?.length || 0} TOOLS</div>
    `;
    projectItem.addEventListener('click', () => showProject(index));
    projectsList.appendChild(projectItem);
  });
}

// Show project detail
async function showProject(index) {
  currentProjectIndex = index;
  const project = projects[index];

  emptyState.style.display = 'none';
  projectForm.style.display = 'none';
  projectDetail.style.display = 'block';

  document.getElementById('project-name').textContent = project.name;
  document.getElementById('project-description').textContent = project.description || 'No description';

  renderTools(project.tools || []);
  renderProjects();

  // Update tray menu with current project
  await ipcRenderer.invoke('set-current-project', project);
}

// Render tools grid
function renderTools(tools) {
  toolsGrid.innerHTML = '';

  if (tools.length === 0) {
    toolsGrid.innerHTML = '<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: #666;">No tools configured yet. Click EDIT to add tools.</div>';
    return;
  }

  tools.forEach((tool, index) => {
    const toolType = toolTypes[tool.type] || { icon: '⚙️', label: 'Tool' };
    const toolCard = document.createElement('div');
    toolCard.className = 'tool-card';

    let displayValue = '';
    if (tool.path) displayValue = tool.path;
    else if (tool.url) displayValue = tool.url;
    else if (tool.command) displayValue = tool.command;

    toolCard.innerHTML = `
      <div class="tool-icon">${toolType.icon}</div>
      <h3>${tool.name}</h3>
      <p>${displayValue}</p>
    `;

    toolCard.addEventListener('click', () => launchTool(tool));
    toolsGrid.appendChild(toolCard);
  });
}

// Launch a tool
async function launchTool(tool) {
  try {
    const result = await ipcRenderer.invoke('launch-tool', tool);
    if (!result.success) {
      alert(`Failed to launch ${tool.name}: ${result.error}`);
    }
  } catch (error) {
    alert(`Error launching ${tool.name}: ${error.message}`);
  }
}

// Launch all tools
async function launchAll() {
  const project = projects[currentProjectIndex];
  if (!project.tools || project.tools.length === 0) {
    alert('No tools to launch');
    return;
  }

  for (const tool of project.tools) {
    await launchTool(tool);
    // Small delay between launches
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

// Drag and drop state
let draggedElement = null;

// Setup drag and drop for tool items
function setupDragAndDrop(toolItem) {
  toolItem.addEventListener('dragstart', handleDragStart);
  toolItem.addEventListener('dragend', handleDragEnd);
  toolItem.addEventListener('dragover', handleDragOver);
  toolItem.addEventListener('drop', handleDrop);
  toolItem.addEventListener('dragenter', handleDragEnter);
  toolItem.addEventListener('dragleave', handleDragLeave);
}

function handleDragStart(e) {
  draggedElement = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
  this.classList.remove('dragging');

  // Remove drag-over class from all items
  document.querySelectorAll('.tool-form-item').forEach(item => {
    item.classList.remove('drag-over');
  });

  draggedElement = null;
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  if (this !== draggedElement) {
    this.classList.add('drag-over');
  }
}

function handleDragLeave(e) {
  this.classList.remove('drag-over');
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  if (draggedElement !== this) {
    const toolsFormList = document.getElementById('tools-form-list');
    const allItems = [...toolsFormList.children];
    const draggedIndex = allItems.indexOf(draggedElement);
    const targetIndex = allItems.indexOf(this);

    if (draggedIndex < targetIndex) {
      this.parentNode.insertBefore(draggedElement, this.nextSibling);
    } else {
      this.parentNode.insertBefore(draggedElement, this);
    }
  }

  return false;
}

// Show project form (add or edit)
function showProjectForm(isEdit = false) {
  emptyState.style.display = 'none';
  projectDetail.style.display = 'none';
  projectForm.style.display = 'block';

  const formTitle = document.getElementById('form-title');
  const formProjectName = document.getElementById('form-project-name');
  const formProjectDescription = document.getElementById('form-project-description');
  const toolsFormList = document.getElementById('tools-form-list');

  if (isEdit && currentProjectIndex !== null) {
    editingProjectIndex = currentProjectIndex;
    const project = projects[currentProjectIndex];

    formTitle.textContent = 'EDIT PROJECT';
    formProjectName.value = project.name;
    formProjectDescription.value = project.description || '';
    deleteProjectBtn.style.display = 'block';

    toolsFormList.innerHTML = '';
    (project.tools || []).forEach((tool, index) => {
      addToolFormItem(tool);
    });
  } else {
    editingProjectIndex = null;
    formTitle.textContent = 'NEW PROJECT';
    formProjectName.value = '';
    formProjectDescription.value = '';
    deleteProjectBtn.style.display = 'none';
    toolsFormList.innerHTML = '';
  }
}

// Add tool form item
function addToolFormItem(tool = null) {
  const toolsFormList = document.getElementById('tools-form-list');
  const toolIndex = toolsFormList.children.length;

  const toolItem = document.createElement('div');
  toolItem.className = 'tool-form-item';
  toolItem.dataset.toolIndex = toolIndex;

  const toolType = tool?.type || 'vscode';
  const fields = toolTypes[toolType].fields;

  let fieldsHtml = '';
  fields.forEach(field => {
    const value = tool?.[field] || '';
    const label = field.charAt(0).toUpperCase() + field.slice(1);
    const needsPicker = field === 'path';
    const pickerType = toolType === 'file' ? 'file' : 'directory';

    fieldsHtml += `
      <div class="tool-form-field" style="position: relative;">
        <label>${label.toUpperCase()}</label>
        <div style="display: flex; gap: 8px;">
          <input type="text" class="tool-${field}" value="${value}" placeholder="Enter ${label}" style="flex: 1;">
          ${needsPicker ? `<button class="btn-browse" data-field="${field}" data-picker-type="${pickerType}">📁</button>` : ''}
        </div>
      </div>
    `;
  });

  toolItem.innerHTML = `
    <div class="tool-form-header">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
        <h4>TOOL ${toolIndex + 1}</h4>
      </div>
      <button class="btn-remove-tool" onclick="removeToolFormItem(this)">×</button>
    </div>
    <div class="tool-form-row">
      <div class="tool-form-field">
        <label>NAME</label>
        <input type="text" class="tool-name" value="${tool?.name || ''}" placeholder="Enter tool name">
      </div>
      <div class="tool-form-field">
        <label>TYPE</label>
        <select class="tool-type" onchange="updateToolFields(this)">
          ${Object.entries(toolTypes).map(([key, val]) =>
            `<option value="${key}" ${toolType === key ? 'selected' : ''}>${val.label}</option>`
          ).join('')}
        </select>
      </div>
    </div>
    <div class="tool-form-row tool-fields">
      ${fieldsHtml}
    </div>
  `;

  toolsFormList.appendChild(toolItem);

  // Add event listeners for browse buttons
  toolItem.querySelectorAll('.btn-browse').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const field = btn.dataset.field;
      const pickerType = btn.dataset.pickerType;
      const input = btn.parentElement.querySelector(`.tool-${field}`);

      const result = pickerType === 'file'
        ? await ipcRenderer.invoke('select-file')
        : await ipcRenderer.invoke('select-directory');

      if (result.success) {
        input.value = result.path;
      }
    });
  });

  // Add drag-and-drop event listeners
  setupDragAndDrop(toolItem);

  // Make only the drag handle initiate dragging
  const dragHandle = toolItem.querySelector('.drag-handle');
  dragHandle.addEventListener('mousedown', () => {
    toolItem.draggable = true;
  });

  dragHandle.addEventListener('mouseup', () => {
    toolItem.draggable = false;
  });

  // Ensure draggable is reset
  toolItem.addEventListener('dragend', () => {
    toolItem.draggable = false;
  });
}

// Remove tool form item
function removeToolFormItem(button) {
  button.closest('.tool-form-item').remove();
}

// Update tool fields based on type
function updateToolFields(select) {
  const toolItem = select.closest('.tool-form-item');
  const toolType = select.value;
  const fields = toolTypes[toolType].fields;
  const fieldsContainer = toolItem.querySelector('.tool-fields');

  let fieldsHtml = '';
  fields.forEach(field => {
    const label = field.charAt(0).toUpperCase() + field.slice(1);
    const needsPicker = field === 'path';
    const pickerType = toolType === 'file' ? 'file' : 'directory';

    fieldsHtml += `
      <div class="tool-form-field" style="position: relative;">
        <label>${label.toUpperCase()}</label>
        <div style="display: flex; gap: 8px;">
          <input type="text" class="tool-${field}" placeholder="Enter ${label}" style="flex: 1;">
          ${needsPicker ? `<button class="btn-browse" data-field="${field}" data-picker-type="${pickerType}">📁</button>` : ''}
        </div>
      </div>
    `;
  });

  fieldsContainer.innerHTML = fieldsHtml;

  // Add event listeners for browse buttons
  fieldsContainer.querySelectorAll('.btn-browse').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const field = btn.dataset.field;
      const pickerType = btn.dataset.pickerType;
      const input = btn.parentElement.querySelector(`.tool-${field}`);

      const result = pickerType === 'file'
        ? await ipcRenderer.invoke('select-file')
        : await ipcRenderer.invoke('select-directory');

      if (result.success) {
        input.value = result.path;
      }
    });
  });
}

// Save project
async function saveProject() {
  const name = document.getElementById('form-project-name').value.trim();
  const description = document.getElementById('form-project-description').value.trim();

  if (!name) {
    alert('Please enter a project name');
    return;
  }

  const tools = [];
  const toolItems = document.querySelectorAll('.tool-form-item');

  toolItems.forEach(item => {
    const toolName = item.querySelector('.tool-name').value.trim();
    const toolType = item.querySelector('.tool-type').value;

    if (!toolName) return;

    const tool = { name: toolName, type: toolType };

    const fields = toolTypes[toolType].fields;
    fields.forEach(field => {
      const input = item.querySelector(`.tool-${field}`);
      if (input) {
        tool[field] = input.value.trim();
      }
    });

    tools.push(tool);
  });

  const project = { name, description, tools };

  if (editingProjectIndex !== null) {
    projects[editingProjectIndex] = project;
    currentProjectIndex = editingProjectIndex;
  } else {
    projects.push(project);
    currentProjectIndex = projects.length - 1;
  }

  const saved = await ipcRenderer.invoke('save-projects', projects);
  if (saved) {
    renderProjects();
    showProject(currentProjectIndex);
  } else {
    alert('Failed to save project');
  }
}

// Delete project
async function deleteProject() {
  if (!confirm('Are you sure you want to delete this project?')) {
    return;
  }

  projects.splice(editingProjectIndex, 1);
  const saved = await ipcRenderer.invoke('save-projects', projects);

  if (saved) {
    renderProjects();

    if (projects.length > 0) {
      showProject(0);
    } else {
      currentProjectIndex = null;
      emptyState.style.display = 'flex';
      projectDetail.style.display = 'none';
      projectForm.style.display = 'none';
    }
  } else {
    alert('Failed to delete project');
  }
}

// Cancel form
function cancelForm() {
  if (currentProjectIndex !== null) {
    showProject(currentProjectIndex);
  } else {
    emptyState.style.display = 'flex';
    projectDetail.style.display = 'none';
    projectForm.style.display = 'none';
  }
}

// Event Listeners
addProjectBtn.addEventListener('click', () => showProjectForm(false));
editProjectBtn.addEventListener('click', () => showProjectForm(true));
launchAllBtn.addEventListener('click', launchAll);
saveProjectBtn.addEventListener('click', saveProject);
cancelBtn.addEventListener('click', cancelForm);
cancelFormBtn.addEventListener('click', cancelForm);
deleteProjectBtn.addEventListener('click', deleteProject);
addToolBtn.addEventListener('click', () => addToolFormItem());

minimizeBtn.addEventListener('click', () => {
  ipcRenderer.invoke('minimize-window');
});

closeBtn.addEventListener('click', () => {
  ipcRenderer.invoke('close-window');
});

// Make functions global for onclick handlers
window.removeToolFormItem = removeToolFormItem;
window.updateToolFields = updateToolFields;

// Initialize app
init();
