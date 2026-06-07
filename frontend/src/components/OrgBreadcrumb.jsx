export default function OrgBreadcrumb({ realityName, path, onNavigate }) {
  return (
    <nav className="flex items-center gap-1 text-sm text-neutral-400 flex-wrap">
      <button onClick={() => onNavigate(-1)}
        className="hover:text-white transition font-medium text-indigo-400">
        {realityName}
      </button>
      {path.map((node, index) => (
        <span key={node.id} className="flex items-center gap-1">
          <span className="text-neutral-600">/</span>
          <button onClick={() => onNavigate(index)}
            className={`hover:text-white transition truncate max-w-[120px] ${
              index === path.length - 1 ? 'text-white' : 'text-neutral-400'
            }`}>
            {node.name}
          </button>
        </span>
      ))}
    </nav>
  )
}
