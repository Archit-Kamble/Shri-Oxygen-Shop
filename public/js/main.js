document.addEventListener('DOMContentLoaded', function(){
  const gasSelect = document.getElementById('returnGas');
  const activeSelect = document.getElementById('activeSelect');
  const returnMsg = document.getElementById('returnMsg');

  function loadActive(g) {
    activeSelect.innerHTML = '<option value="">Loading...</option>';
    fetch('/api/active?gas=' + encodeURIComponent(g)).then(r=>r.json()).then(data=>{
      activeSelect.innerHTML = '';
      if (!data.list || data.list.length===0) {
        activeSelect.innerHTML = '<option value="">-- No active cylinders --</option>';
      } else {
        data.list.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c;
          opt.textContent = c;
          activeSelect.appendChild(opt);
        });
      }
    }).catch(err=>{
      activeSelect.innerHTML = '<option value="">Error</option>';
    });
  }

  if (gasSelect) {
    loadActive(gasSelect.value);
    gasSelect.addEventListener('change', ()=>loadActive(gasSelect.value));
  }
});

function scrollToSection(id){
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({behavior:'smooth'});
}