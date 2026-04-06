import React from 'react';
import './ui.css';

export function Card({
  title,
  tag,
  description,
  children,
}: {
  title: string;
  tag: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div data-card={title} className="card">
      <div className="card-header">
        <h3 className="card-title">{title}</h3>
        <code className="card-tag">{tag}</code>
      </div>
      <p className="card-description">{description}</p>
      {children}
    </div>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="panel" style={style}>
      {children}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="label">{children}</p>
  );
}
